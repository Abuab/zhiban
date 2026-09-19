import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { EntitlementService } from './entitlement.service.js';
import { OrderEntity } from './entities/order.entity.js';
import { PaymentNotifyLogEntity } from './entities/payment-notify-log.entity.js';
import { UserEntity } from '../account/entities/user.entity.js';
import type { PaymentGateway } from './gateways/payment-gateway.interface.js';
import { ORDER_STATUS_CLOSED, ORDER_STATUS_PAID, ORDER_STATUS_PAYING } from './payment.constants.js';
import { OrderService } from './order.service.js';
import type { NotifyParseResult, PrepayResult, QueryOrderResult } from './payment.types.js';
import { ProductService } from './product.service.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * 订单服务（模块 6）
 *
 * 覆盖模块 6 的完成标准：
 *   ① 伪造回调被拒（验签失败 → 只留证不入账，且应答 FAIL 让网关重推）
 *   ② 重复回调幂等（已支付订单再回调 → 不重复发权益）
 *   ③ 金额篡改被拒（回调金额与本地订单不一致 → 不入账，转人工）
 *   ④ 超时关闭（E3）
 *   ⑤ 查单补单（E1）
 *
 * 这些断言保护的是**钱**：任何一条写错都会导致「白拿权益」或「付了钱没解锁」。
 */
describe('OrderService 订单与支付回调', () => {
  const product = {
    id: 11,
    code: 'double_invite',
    name: '双人对比报告解锁',
    price: 8,
    benefitsJson: [{ type: 'double_report' }],
    iosVisible: 0,
    status: 'on',
  };

  const orderRepository = {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(),
    create: vi.fn((input: unknown) => input),
    update: vi.fn(),
    manager: { transaction: vi.fn() },
  };
  const txRepository = { findOne: vi.fn(), update: vi.fn() };
  const manager = { getRepository: vi.fn(() => txRepository) };

  const notifyLogRepository = {
    save: vi.fn(),
    create: vi.fn((input: unknown) => input),
    update: vi.fn(),
  };
  const userRepository = { findOne: vi.fn() };
  const gateway = {
    kind: 'mock',
    supportsQuery: true,
    prepay: vi.fn(),
    parseNotify: vi.fn(),
    queryOrder: vi.fn(),
    refund: vi.fn(),
  };
  const productService = { requireOnSale: vi.fn(), findByCode: vi.fn() };
  const entitlementService = { grant: vi.fn(), revokeBySourceRef: vi.fn() };
  const redisService = { setIfAbsent: vi.fn(), set: vi.fn() };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const buildService = (): OrderService =>
    new OrderService(
      orderRepository as unknown as Repository<OrderEntity>,
      notifyLogRepository as unknown as Repository<PaymentNotifyLogEntity>,
      userRepository as unknown as Repository<UserEntity>,
      gateway as unknown as PaymentGateway,
      productService as unknown as ProductService,
      entitlementService as unknown as EntitlementService,
      redisService as unknown as RedisService,
      { get: () => ({ orderExpireMinutes: 30 }) } as unknown as ConfigService,
      logger as unknown as AppLogger,
    );

  const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
    ({
      id: 100,
      outTradeNo: 'ZB20260919120000123456',
      userId: 7,
      productId: 11,
      productSnapshot: { code: product.code, name: product.name, price: product.price, benefits: [] },
      amount: 8,
      status: ORDER_STATUS_PAYING,
      prepayId: 'prepay_1',
      transactionId: null,
      paidAt: null,
      expireAt: new Date(Date.now() + 30 * 60_000),
      refundedAt: null,
      createdAt: new Date('2026-09-19T12:00:00Z'),
      updatedAt: new Date('2026-09-19T12:00:00Z'),
      ...overrides,
    }) as OrderEntity;

  const verifiedNotify = (overrides: Partial<NotifyParseResult['payment']> = {}): NotifyParseResult => ({
    verified: true,
    payment: {
      outTradeNo: 'ZB20260919120000123456',
      transactionId: 'wx_123',
      amountTotal: 800,
      tradeState: 'SUCCESS',
      successTime: '2026-09-19T12:00:10Z',
      ...overrides,
    },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    orderRepository.manager.transaction.mockImplementation(
      (callback: (m: typeof manager) => Promise<unknown>) => callback(manager),
    );
    orderRepository.create.mockImplementation((input: unknown) => input);
    notifyLogRepository.create.mockImplementation((input: unknown) => input);
    notifyLogRepository.save.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ id: 1, ...input }),
    );
    gateway.supportsQuery = true;
    productService.requireOnSale.mockResolvedValue(product);
    userRepository.findOne.mockResolvedValue({ id: 7, openid: 'openid_7' });
    redisService.setIfAbsent.mockResolvedValue(true);
  });

  // ------------------------------------------------------------ ① 伪造回调

  it('验签失败：留证（verify_result=0/processed=0）、不入账、应答 FAIL 让网关重推', async () => {
    gateway.parseNotify.mockResolvedValue({ verified: false, reason: '签名不匹配' });

    const result = await buildService().handleNotify({}, '{"forged":true}');

    expect(result).toBe(false);
    // 证据必须落地：伪造报文是安全事件，不能因为「验签失败」就丢掉
    expect(notifyLogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ verifyResult: 0, processed: 0, idempotentHit: 0 }),
    );
    expect(entitlementService.grant).not.toHaveBeenCalled();
    expect(orderRepository.manager.transaction).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ ② 重复回调幂等

  it('首次成功回调：订单置已支付 + 发放权益 + 台账标记 processed', async () => {
    gateway.parseNotify.mockResolvedValue(verifiedNotify());
    txRepository.findOne.mockResolvedValue(makeOrder());
    entitlementService.grant.mockResolvedValue({ id: 1 });

    const result = await buildService().handleNotify({}, '{"ok":true}');

    expect(result).toBe(true);
    expect(txRepository.update).toHaveBeenCalledWith(
      { id: 100 },
      expect.objectContaining({ status: ORDER_STATUS_PAID, transactionId: 'wx_123' }),
    );
    expect(entitlementService.grant).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ userId: 7, productId: 11, source: 'order', sourceRef: 'ZB20260919120000123456' }),
    );
    expect(notifyLogRepository.update).toHaveBeenCalledWith(
      { id: 1 },
      { idempotentHit: 0, processed: 1 },
    );
  });

  it('重复回调（订单已支付）：返回成功但**不重复发权益**，台账标 idempotent_hit=1', async () => {
    gateway.parseNotify.mockResolvedValue(verifiedNotify());
    txRepository.findOne.mockResolvedValue(makeOrder({ status: ORDER_STATUS_PAID, paidAt: new Date() }));

    const result = await buildService().handleNotify({}, '{"again":true}');

    expect(result).toBe(true);
    expect(entitlementService.grant).not.toHaveBeenCalled();
    expect(txRepository.update).not.toHaveBeenCalled();
    expect(notifyLogRepository.update).toHaveBeenCalledWith(
      { id: 1 },
      { idempotentHit: 1, processed: 1 },
    );
  });

  // ------------------------------------------------------------ ③ 金额篡改

  it('回调金额与本地订单不一致：不入账、应答 FAIL（转人工核查）', async () => {
    // 攻击面：伪造一个「1 分钱」的成功回调去冲抵 8 元的订单
    gateway.parseNotify.mockResolvedValue(verifiedNotify({ amountTotal: 1 }));
    txRepository.findOne.mockResolvedValue(makeOrder());

    const result = await buildService().handleNotify({}, '{"amount":1}');

    expect(result).toBe(false);
    expect(entitlementService.grant).not.toHaveBeenCalled();
    expect(txRepository.update).not.toHaveBeenCalled();
    expect(notifyLogRepository.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('回调订单号不存在：不入账、应答 FAIL（本地无此单，不能凭回调凭空发权益）', async () => {
    gateway.parseNotify.mockResolvedValue(verifiedNotify({ outTradeNo: 'ZB_NOT_EXIST' }));
    txRepository.findOne.mockResolvedValue(null);

    const result = await buildService().handleNotify({}, '{"unknown":true}');

    expect(result).toBe(false);
    expect(entitlementService.grant).not.toHaveBeenCalled();
  });

  it('非成功态回调（CLOSED）：留证但应答成功（不再重推），不入账', async () => {
    gateway.parseNotify.mockResolvedValue(verifiedNotify({ tradeState: 'CLOSED' }));

    const result = await buildService().handleNotify({}, '{"state":"CLOSED"}');

    expect(result).toBe(true);
    expect(entitlementService.grant).not.toHaveBeenCalled();
    expect(orderRepository.manager.transaction).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ ④ 超时关闭

  it('超时关闭：把 created/paying 且已过期的订单置为 closed 并返回条数（E3）', async () => {
    orderRepository.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const closed = await buildService().closeOverdue();

    expect(closed).toBe(2);
    expect(orderRepository.update).toHaveBeenCalledWith(
      { id: expect.anything() },
      { status: ORDER_STATUS_CLOSED },
    );
  });

  it('超时关闭：无过期订单时不执行 update（避免空事务）', async () => {
    orderRepository.find.mockResolvedValue([]);

    expect(await buildService().closeOverdue()).toBe(0);
    expect(orderRepository.update).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ ⑤ 查单补单

  it('恢复购买：网关查得 SUCCESS → 补入账，recovered = true（E1）', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder());
    gateway.queryOrder.mockResolvedValue({
      outTradeNo: 'ZB20260919120000123456',
      tradeState: 'SUCCESS',
      amountTotal: 800,
      transactionId: 'wx_123',
      successTime: null,
    } satisfies QueryOrderResult);
    txRepository.findOne.mockResolvedValue(makeOrder());
    entitlementService.grant.mockResolvedValue({ id: 1 });
    // settle 之后服务重新读一次订单
    orderRepository.findOne
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: ORDER_STATUS_PAID, paidAt: new Date() }));

    const detail = await buildService().recover(7, 'ZB20260919120000123456');

    expect(detail.recovered).toBe(true);
    expect(detail.status).toBe(ORDER_STATUS_PAID);
    expect(entitlementService.grant).toHaveBeenCalled();
  });

  it('恢复购买：网关不支持查单（free/mock）时如实返回本地状态，**不伪造已支付**', async () => {
    gateway.supportsQuery = false;
    orderRepository.findOne.mockResolvedValue(makeOrder());

    const detail = await buildService().recover(7, 'ZB20260919120000123456');

    expect(detail.status).toBe(ORDER_STATUS_PAYING);
    expect(detail.recovered).toBe(false);
    expect(gateway.queryOrder).not.toHaveBeenCalled();
  });

  it('恢复购买：无未完成订单时返回 null（端上提示「没有待恢复的订单」）', async () => {
    orderRepository.findOne.mockResolvedValue(null);

    expect(await buildService().recoverLatest(7)).toBeNull();
    expect(gateway.queryOrder).not.toHaveBeenCalled();
  });

  it('查单补单：网关查得金额不一致 → 抛错且不发权益（金额是第一道闸）', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder());
    gateway.queryOrder.mockResolvedValue({
      outTradeNo: 'ZB20260919120000123456',
      tradeState: 'SUCCESS',
      amountTotal: 1,
      transactionId: 'wx_123',
      successTime: null,
    } satisfies QueryOrderResult);
    txRepository.findOne.mockResolvedValue(makeOrder());

    await expect(buildService().recover(7, 'ZB20260919120000123456')).rejects.toMatchObject({
      response: { code: 60007 },
    });
    expect(entitlementService.grant).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ 下单（E9 / 免费直发）

  it('下单：免费网关 settled → 直接入账（端上无需支付动作），launchParams 为 null', async () => {
    orderRepository.findOne.mockResolvedValue(null);
    orderRepository.save.mockResolvedValue(makeOrder());
    gateway.prepay.mockResolvedValue({
      launchParams: null,
      prepayId: null,
      settled: true,
    } satisfies PrepayResult);
    txRepository.findOne.mockResolvedValue(makeOrder());
    entitlementService.grant.mockResolvedValue({ id: 1 });
    orderRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeOrder({ status: ORDER_STATUS_PAID, paidAt: new Date() }));

    const result = await buildService().create(7, 'double_invite');

    expect(result.settled).toBe(true);
    expect(result.status).toBe(ORDER_STATUS_PAID);
    expect(result.launchParams).toBeNull();
    expect(entitlementService.grant).toHaveBeenCalled();
  });

  it('下单：请求体不接受金额 —— 落库金额取自 product.price（E4）', async () => {
    orderRepository.findOne.mockResolvedValue(null);
    orderRepository.save.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(makeOrder({ ...input, id: 100 })),
    );
    gateway.prepay.mockResolvedValue({ launchParams: null, prepayId: 'p', settled: false } satisfies PrepayResult);

    await buildService().create(7, 'double_invite');

    // create 只接收 productCode；商品价格为 8 元，与调用方传入的任何值无关
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8, productId: 11 }),
    );
  });

  it('下单：存在未过期未支付订单 → 复用而不新建（E9）', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder());
    gateway.prepay.mockResolvedValue({ launchParams: null, prepayId: 'p', settled: false } satisfies PrepayResult);

    const result = await buildService().create(7, 'double_invite');

    expect(result.outTradeNo).toBe('ZB20260919120000123456');
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('下单：未支付订单已过期 → 顺手关闭并新建（懒判定兜底）', async () => {
    orderRepository.findOne
      .mockResolvedValueOnce(makeOrder({ expireAt: new Date(Date.now() - 1000) }))
      .mockResolvedValueOnce(null);
    orderRepository.save.mockResolvedValue(makeOrder({ id: 200, outTradeNo: 'ZB_NEW' }));
    gateway.prepay.mockResolvedValue({ launchParams: null, prepayId: 'p', settled: false } satisfies PrepayResult);

    const result = await buildService().create(7, 'double_invite');

    expect(orderRepository.update).toHaveBeenCalledWith(
      { id: 100 },
      { status: ORDER_STATUS_CLOSED },
    );
    expect(result.outTradeNo).toBe('ZB_NEW');
  });

  it('下单：商品已下架 / 不存在 → 抛 60003，不落任何订单', async () => {
    productService.requireOnSale.mockRejectedValue(
      new BusinessException(ErrorCode.PRODUCT_UNAVAILABLE),
    );

    await expect(buildService().create(7, 'double_invite')).rejects.toMatchObject({
      response: { code: ErrorCode.PRODUCT_UNAVAILABLE },
    });
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('退款：网关退款失败 → 订单回滚为已支付（不能卡在 refunding）并抛错', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder({ status: ORDER_STATUS_PAID, paidAt: new Date() }));
    gateway.refund.mockRejectedValue(new Error('网关超时'));

    await expect(buildService().refund('ZB20260919120000123456', '用户申请')).rejects.toMatchObject({
      response: { code: 60005 },
    });
    expect(orderRepository.update).toHaveBeenCalledWith(
      { id: 100 },
      { status: ORDER_STATUS_PAID },
    );
    expect(entitlementService.revokeBySourceRef).not.toHaveBeenCalled();
  });

  it('退款：未支付订单不可退（60011），不调用网关', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder({ status: ORDER_STATUS_CLOSED }));

    await expect(buildService().refund('ZB20260919120000123456', '用户申请')).rejects.toMatchObject({
      response: { code: 60011 },
    });
    expect(gateway.refund).not.toHaveBeenCalled();
  });

  it('退款成功：置已退款 + 收回权益（E10），同一事务', async () => {
    orderRepository.findOne.mockResolvedValue(makeOrder({ status: ORDER_STATUS_PAID, paidAt: new Date() }));
    gateway.refund.mockResolvedValue({ refundId: 'rf_1', status: 'SUCCESS' });
    entitlementService.revokeBySourceRef.mockResolvedValue(1);

    const detail = await buildService().refund('ZB20260919120000123456', '用户申请');

    expect(orderRepository.manager.transaction).toHaveBeenCalled();
    expect(txRepository.update).toHaveBeenCalledWith(
      { id: 100 },
      expect.objectContaining({ status: 'refunded' }),
    );
    expect(entitlementService.revokeBySourceRef).toHaveBeenCalledWith(manager, 'ZB20260919120000123456');
    expect(detail.amount).toBe(8);
  });
});
