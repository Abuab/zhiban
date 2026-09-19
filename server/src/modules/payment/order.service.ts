import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { PaymentConfig } from '../../config/configuration.js';
import { UserEntity } from '../account/entities/user.entity.js';
import { RedisService } from '../redis/redis.service.js';
import { EntitlementService } from './entitlement.service.js';
import { OrderEntity, type OrderProductSnapshot } from './entities/order.entity.js';
import { PaymentNotifyLogEntity } from './entities/payment-notify-log.entity.js';
import { ProductEntity } from './entities/product.entity.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateways/payment-gateway.interface.js';
import {
  ENTITLEMENT_SOURCE_ORDER,
  ORDER_OPEN_STATUSES,
  ORDER_REUSE_KEY_PREFIX,
  ORDER_STATUS_CLOSED,
  ORDER_STATUS_CREATED,
  ORDER_STATUS_PAID,
  ORDER_STATUS_PAYING,
  ORDER_STATUS_REFUNDED,
  ORDER_STATUS_REFUNDING,
  OUT_TRADE_NO_PREFIX,
} from './payment.constants.js';
import { fenToYuan, yuanToFen } from './payment.money.js';
import type { CreateOrderResult, OrderDetailView, PrepayResult } from './payment.types.js';
import { ProductService } from './product.service.js';

/** 回调报文入库前的截断长度（raw_body 为 TEXT，避免超长报文写入失败反而丢失证据） */
const RAW_BODY_MAX_LENGTH = 60_000;

/** 并发建单冲突后的重查等待（毫秒） */
const RACE_REQUERY_DELAY_MS = 300;

/**
 * 订单服务（模块 6）
 *
 * 规格依据：
 *   - PRD-005 §2 入账流程：预下单 → 支付 → 回调 → 验签 → 幂等 → 发放权益
 *   - 边界总表 E1（漏单兜底：查单/对账 + 恢复购买）/ E2（out_trade_no 幂等）
 *     / E3（30 分钟保留）/ E4（金额以后端为准）/ E5（支付前年龄确认由端上与账号域保证）
 *     / E6（商品快照）/ E9（预下单幂等）/ E10（退款收回权益）
 *
 * 安全自查（「恶意用户会怎么攻击这里」）：
 *   1. **篡改金额**：请求体不接收任何金额字段，一律读 `product.price`（E4）
 *   2. **伪造回调**：验签在 `PaymentGateway.parseNotify` 内完成，未通过则只留证不入账
 *   3. **重放回调**：时间戳窗口（网关内）+ `out_trade_no` 幂等（本服务内）双重拦截
 *   4. **拿小额单冲抵大额单**：入账前比对回调金额与本地订单金额，不一致拒绝并告警
 *   5. **并发重复建单**：Redis 原子占位 + 冲突后重查，避免刷出一堆未支付订单
 *   6. **越权查单**：查单/恢复购买一律带 `userId` 过滤，他人的单等同于不存在
 */
@Injectable()
export class OrderService {
  private readonly orderExpireMinutes: number;

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(PaymentNotifyLogEntity)
    private readonly notifyLogRepository: Repository<PaymentNotifyLogEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly productService: ProductService,
    private readonly entitlementService: EntitlementService,
    private readonly redisService: RedisService,
    configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orderExpireMinutes = (configService.get<PaymentConfig>('payment') as PaymentConfig)
      .orderExpireMinutes;
  }

  /**
   * 创建订单（E9：同用户同商品存在未完成订单则复用）
   *
   * @param userId 当前登录用户
   * @param productCode 商品编码；**金额一律以库中商品为准**（E4）
   */
  async create(userId: number, productCode: string): Promise<CreateOrderResult> {
    const product = await this.productService.requireOnSale(productCode);

    // 1. 优先复用库里未完成且未过期的同商品订单
    const reusable = await this.findOpenOrder(userId, product.id);
    if (reusable) {
      return this.prepay(userId, reusable, product);
    }

    // 2. 新建：用 Redis 原子占位拦住并发（两个请求同时走到这里会各建一单）
    const reuseKey = `${ORDER_REUSE_KEY_PREFIX}${userId}:${productCode}`;
    const ttlSeconds = this.orderExpireMinutes * 60;
    const locked = await this.redisService.setIfAbsent(reuseKey, 'pending', ttlSeconds);
    if (!locked) {
      await this.delay(RACE_REQUERY_DELAY_MS);
      const raced = await this.findOpenOrder(userId, product.id);
      if (raced) {
        this.logger.log(
          `并发下单命中复用：userId=${userId} product=${productCode} outTradeNo=${raced.outTradeNo}`,
          'OrderService',
        );
        return this.prepay(userId, raced, product);
      }
    }

    const order = await this.createOrderRow(userId, product);
    await this.redisService.set(reuseKey, order.outTradeNo, ttlSeconds);
    return this.prepay(userId, order, product);
  }

  /**
   * 处理支付回调（微信 → 服务端）
   *
   * @returns true = 处理成功（应答 SUCCESS，微信不再重推）；false = 应答 FAIL，微信会重推
   *
   * ⚠️ 无论成功与否，**原始报文一律先落 payment_notify_log**：
   *    验签失败的报文是安全事件证据，处理失败的报文是人工补单依据。
   */
  async handleNotify(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<boolean> {
    const parsed = await this.gateway.parseNotify({ headers, rawBody });

    const logRow = await this.notifyLogRepository.save(
      this.notifyLogRepository.create({
        outTradeNo: parsed.payment?.outTradeNo ?? null,
        rawBody: rawBody.slice(0, RAW_BODY_MAX_LENGTH),
        verifyResult: parsed.verified ? 1 : 0,
        idempotentHit: 0,
        processed: 0,
      }),
    );

    if (!parsed.verified || !parsed.payment) {
      // 伪造回调：只留证 + 告警，不入账（返回 false 让微信侧看到失败，便于风控发现异常来源）
      this.logger.warn(
        `支付回调验签失败（已留证）：${parsed.reason ?? '未知原因'} 报文长度=${rawBody.length}`,
        'OrderService',
      );
      return false;
    }

    const payment = parsed.payment;
    if (payment.tradeState !== 'SUCCESS') {
      // 非成功态（如 CLOSED / REFUND）不入账，但已留证
      await this.notifyLogRepository.update({ id: logRow.id }, { processed: 1 });
      this.logger.log(
        `支付回调为非成功态，仅留证不入账：outTradeNo=${payment.outTradeNo} state=${payment.tradeState}`,
        'OrderService',
      );
      return true;
    }

    try {
      const result = await this.settle({
        outTradeNo: payment.outTradeNo,
        transactionId: payment.transactionId,
        amountTotalFen: payment.amountTotal,
      });
      await this.notifyLogRepository.update(
        { id: logRow.id },
        { idempotentHit: result.idempotent ? 1 : 0, processed: 1 },
      );
      return true;
    } catch (error) {
      // 金额不一致 / 订单不存在等情况：落告警并返回失败，让微信重推 + 人工介入（E1）
      this.logger.error(
        `支付回调入账失败（已留证，等待人工核查）：outTradeNo=${payment.outTradeNo} ` +
          `原因=${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'OrderService',
      );
      return false;
    }
  }

  /**
   * 恢复购买（E1：端上「恢复购买」按钮触发查单补单）
   * 取该用户最近一笔未完成订单去网关查单；查得成功则补入账。
   */
  async recoverLatest(userId: number): Promise<OrderDetailView | null> {
    const order = await this.orderRepository.findOne({
      where: { userId, status: In(ORDER_OPEN_STATUSES) },
      order: { id: 'DESC' },
    });
    if (!order) return null;
    return this.recover(userId, order.outTradeNo);
  }

  /** 纯读：单笔订单详情（不触发网关查单；端上支付后轮询用） */
  async detail(userId: number, outTradeNo: string): Promise<OrderDetailView> {
    const order = await this.requireOwnOrder(userId, outTradeNo);
    return this.toDetail(order, false);
  }

  /** 指定订单查单补单（越权按「不存在」处理，不泄露存在性） */
  async recover(userId: number, outTradeNo: string): Promise<OrderDetailView> {
    const order = await this.requireOwnOrder(userId, outTradeNo);

    if (order.status === ORDER_STATUS_PAID) {
      return this.toDetail(order, false);
    }

    if (!this.gateway.supportsQuery) {
      // 免费/mock 网关没有外部账单：不伪造「已支付」，只回当前状态
      this.logger.log(
        `当前网关（${this.gateway.kind}）不支持主动查单，恢复购买仅返回本地状态：${outTradeNo}`,
        'OrderService',
      );
      return this.toDetail(order, false);
    }

    const queried = await this.gateway.queryOrder(outTradeNo);
    if (queried.tradeState !== 'SUCCESS') {
      return this.toDetail(order, false);
    }

    await this.settle({
      outTradeNo,
      transactionId: queried.transactionId ?? '',
      amountTotalFen: queried.amountTotal,
    });
    const updated = await this.orderRepository.findOne({ where: { id: order.id } });
    this.logger.log(`恢复购买补单成功：outTradeNo=${outTradeNo}`, 'OrderService');
    return this.toDetail(updated ?? order, true);
  }

  /**
   * 退款（E7/E10）
   *
   * ⚠️ 可退性**业务规则**（如「报告已生成不退」）由调用方判定 —— 该规则依赖报告域，
   *    放在 admin 组合层；本方法只负责资金与权益的原子操作。
   */
  async refund(outTradeNo: string, reason: string): Promise<OrderDetailView> {
    const order = await this.orderRepository.findOne({ where: { outTradeNo } });
    if (!order) throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
    if (order.status === ORDER_STATUS_REFUNDED) {
      return this.toDetail(order, false);
    }
    if (order.status !== ORDER_STATUS_PAID) {
      throw new BusinessException(ErrorCode.REFUND_NOT_ALLOWED);
    }

    await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS_REFUNDING });

    let refundId = '';
    try {
      const result = await this.gateway.refund({
        outTradeNo,
        amountFen: yuanToFen(order.amount),
        reason,
      });
      refundId = result.refundId;
    } catch (error) {
      // 网关退款失败：回滚为已支付，避免卡在 refunding（用户权益仍在，可再次发起）
      await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS_PAID });
      this.logger.error(
        `退款请求失败：outTradeNo=${outTradeNo} 原因=${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'OrderService',
      );
      throw new BusinessException(ErrorCode.PAYMENT_PREPAY_FAILED, '退款失败，请稍后重试');
    }

    await this.orderRepository.manager.transaction(async (manager) => {
      await manager
        .getRepository(OrderEntity)
        .update({ id: order.id }, { status: ORDER_STATUS_REFUNDED, refundedAt: new Date() });
      // E10：退款收回权益（不物理删除，保留留痕）
      const revoked = await this.entitlementService.revokeBySourceRef(manager, outTradeNo);
      this.logger.log(
        `退款完成：outTradeNo=${outTradeNo} refundId=${refundId} 收回权益=${revoked} 条 原因=${reason}`,
        'OrderService',
      );
    });

    const updated = await this.orderRepository.findOne({ where: { id: order.id } });
    return this.toDetail(updated ?? order, false);
  }

  /** 我的订单（端上「订单记录」用；按时间倒序） */
  async listMine(userId: number, limit = 20): Promise<OrderDetailView[]> {
    const rows = await this.orderRepository.find({
      where: { userId },
      order: { id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((row) => this.toDetail(row, false));
  }

  /**
   * 关闭超时未支付订单（E3，定时任务调用）
   * 幂等：只处理 `created` / `paying` 且 `expire_at` 已过者
   */
  async closeOverdue(): Promise<number> {
    const rows = await this.orderRepository.find({
      where: { status: In(ORDER_OPEN_STATUSES), expireAt: LessThan(new Date()) },
      select: { id: true, outTradeNo: true },
    });
    if (rows.length === 0) return 0;

    await this.orderRepository.update(
      { id: In(rows.map((row) => row.id)) },
      { status: ORDER_STATUS_CLOSED },
    );
    this.logger.log(`订单超时关闭：${rows.length} 笔`, 'OrderService');
    return rows.length;
  }

  /**
   * 对账：核对本地已支付订单与网关账单（E1）
   *
   * @returns 差异清单（空数组 = 全部一致）；`supported = false` 表示当前网关无账单可查
   */
  async checkWithGateway(
    from: Date,
    to: Date,
  ): Promise<{ supported: boolean; checked: number; differences: string[] }> {
    if (!this.gateway.supportsQuery) {
      return { supported: false, checked: 0, differences: [] };
    }

    const orders = await this.orderRepository.find({
      where: { status: ORDER_STATUS_PAID, paidAt: LessThan(to) },
      order: { id: 'ASC' },
      take: 500,
    });
    const inRange = orders.filter((order) => order.paidAt && order.paidAt.getTime() >= from.getTime());

    const differences: string[] = [];
    for (const order of inRange) {
      try {
        const queried = await this.gateway.queryOrder(order.outTradeNo);
        if (queried.tradeState !== 'SUCCESS') {
          differences.push(`本地已支付但网关状态为 ${queried.tradeState}：${order.outTradeNo}`);
          continue;
        }
        if (queried.amountTotal !== yuanToFen(order.amount)) {
          differences.push(
            `金额不一致：${order.outTradeNo} 本地=${yuanToFen(order.amount)}分 网关=${queried.amountTotal}分`,
          );
        }
      } catch (error) {
        differences.push(
          `查单失败：${order.outTradeNo} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { supported: true, checked: inRange.length, differences };
  }

  /** 按订单号取订单（后台/对账用，不校验归属） */
  findByOutTradeNo(outTradeNo: string): Promise<OrderEntity | null> {
    return this.orderRepository.findOne({ where: { outTradeNo } });
  }

  /** 后台：分页取订单 */
  async listForAdmin(params: {
    status?: string;
    userId?: number;
    limit: number;
    offset: number;
  }): Promise<{ rows: OrderEntity[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.userId) where.userId = params.userId;

    const [rows, total] = await this.orderRepository.findAndCount({
      where,
      order: { id: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { rows, total };
  }

  // ---------------------------------------------------------------- 内部方法

  /** 查「未完成且未过期」的同商品订单；已过期的顺手关闭（懒判定，不依赖定时任务） */
  private async findOpenOrder(userId: number, productId: number): Promise<OrderEntity | null> {
    const order = await this.orderRepository.findOne({
      where: { userId, productId, status: In(ORDER_OPEN_STATUSES) },
      order: { id: 'DESC' },
    });
    if (!order) return null;

    if (order.expireAt && order.expireAt.getTime() <= Date.now()) {
      await this.orderRepository.update({ id: order.id }, { status: ORDER_STATUS_CLOSED });
      this.logger.log(
        `复用检查发现已过期订单，顺手关闭（懒判定兜底，不依赖定时任务）：${order.outTradeNo}`,
        'OrderService',
      );
      return null;
    }
    return order;
  }

  /** 落一行订单（金额与快照均取自库中商品，E4/E6） */
  private async createOrderRow(userId: number, product: ProductEntity): Promise<OrderEntity> {
    const snapshot: OrderProductSnapshot = {
      code: product.code,
      name: product.name,
      price: product.price,
      benefits: ProductService.parseBenefits(product),
    };

    return this.orderRepository.save(
      this.orderRepository.create({
        outTradeNo: this.buildOutTradeNo(),
        userId,
        productId: product.id,
        productSnapshot: snapshot,
        amount: product.price,
        status: ORDER_STATUS_CREATED,
        prepayId: null,
        transactionId: null,
        paidAt: null,
        expireAt: new Date(Date.now() + this.orderExpireMinutes * 60_000),
        refundedAt: null,
      }),
    );
  }

  /** 预下单：调网关；免费模式直接入账 */
  private async prepay(
    userId: number,
    order: OrderEntity,
    product: ProductEntity,
  ): Promise<CreateOrderResult> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    const amountFen = yuanToFen(order.amount);

    let prepayResult: PrepayResult;
    try {
      prepayResult = await this.gateway.prepay({
        outTradeNo: order.outTradeNo,
        amountFen,
        description: product.name,
        openid: user?.openid ?? '',
      });
    } catch (error) {
      this.logger.error(
        `预下单失败：outTradeNo=${order.outTradeNo} 网关=${this.gateway.kind} ` +
          `原因=${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'OrderService',
      );
      throw new BusinessException(ErrorCode.PAYMENT_PREPAY_FAILED);
    }

    if (prepayResult.settled) {
      // 免费模式（P1）：下单即到账，端上无需任何支付动作
      await this.settle({
        outTradeNo: order.outTradeNo,
        transactionId: `free-${order.outTradeNo}`,
        amountTotalFen: amountFen,
      });
      const settled = await this.orderRepository.findOne({ where: { id: order.id } });
      return {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        amount: order.amount,
        status: settled?.status ?? ORDER_STATUS_PAID,
        settled: true,
        launchParams: null,
      };
    }

    await this.orderRepository.update(
      { id: order.id },
      { status: ORDER_STATUS_PAYING, prepayId: prepayResult.prepayId },
    );

    return {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      amount: order.amount,
      status: ORDER_STATUS_PAYING,
      settled: false,
      launchParams: prepayResult.launchParams,
    };
  }

  /**
   * 入账（幂等）：订单置已支付 + 发放权益，同一事务
   *
   * 幂等三层：
   *   1. 事务内 `pessimistic_write` 锁住订单行，防并发回调双写
   *   2. 已是 `paid` 直接返回 `idempotent = true`
   *   3. 权益发放自身也查重（同 user + product 已有 active 则跳过）
   */
  private async settle(params: {
    outTradeNo: string;
    transactionId: string;
    amountTotalFen: number;
  }): Promise<{ idempotent: boolean }> {
    return this.orderRepository.manager.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(OrderEntity);
      const order = await repository.findOne({
        where: { outTradeNo: params.outTradeNo },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
      }

      if (order.status === ORDER_STATUS_PAID) {
        this.logger.log(`回调幂等命中，直接返回成功：${params.outTradeNo}`, 'OrderService');
        return { idempotent: true };
      }

      // E4：金额必须与本地订单一致，否则拒绝入账（防「小额单冲抵大额单」）
      const expectedFen = yuanToFen(order.amount);
      if (params.amountTotalFen !== expectedFen) {
        throw new BusinessException(
          ErrorCode.PAYMENT_AMOUNT_MISMATCH,
          `回调金额 ${params.amountTotalFen} 分与订单金额 ${expectedFen} 分不一致（${fenToYuan(params.amountTotalFen)} 元 vs ${order.amount} 元）`,
        );
      }

      await repository.update(
        { id: order.id },
        {
          status: ORDER_STATUS_PAID,
          transactionId: params.transactionId,
          paidAt: new Date(),
        },
      );

      await this.entitlementService.grant(manager, {
        userId: order.userId,
        productId: order.productId,
        source: ENTITLEMENT_SOURCE_ORDER,
        sourceRef: order.outTradeNo,
        expireAt: null,
      });

      this.logger.log(
        `订单入账完成：outTradeNo=${order.outTradeNo} userId=${order.userId} 金额=${order.amount} 元`,
        'OrderService',
      );
      return { idempotent: false };
    });
  }

  /** 取属于该用户的订单；他人订单一律按「不存在」处理（防 id 枚举 oracle） */
  private async requireOwnOrder(userId: number, outTradeNo: string): Promise<OrderEntity> {
    const order = await this.orderRepository.findOne({ where: { outTradeNo, userId } });
    if (!order) throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
    return order;
  }

  private toDetail(order: OrderEntity, recovered: boolean): OrderDetailView {
    return {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      productCode: order.productSnapshot?.code ?? '',
      productName: order.productSnapshot?.name ?? '',
      amount: order.amount,
      status: order.status,
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      expireAt: order.expireAt ? order.expireAt.toISOString() : null,
      recovered,
    };
  }

  /** 订单号：ZB + 年月日时分秒 + 6 位随机（唯一性由 uk_out_trade_no 兜底） */
  private buildOutTradeNo(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${OUT_TRADE_NO_PREFIX}${stamp}${randomInt(100_000, 1_000_000)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
