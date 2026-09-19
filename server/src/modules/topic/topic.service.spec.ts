import type { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { EntitlementService } from '../payment/entitlement.service.js';
import { ExclusiveCardService } from './exclusive-card.service.js';
import { TopicCardEntity } from './entities/topic-card.entity.js';
import { TopicReadProgressEntity } from './entities/topic-read-progress.entity.js';
import { TopicEntity } from './entities/topic.entity.js';
import { TOPIC_STATUS_OFF, TOPIC_STATUS_ON } from './topic.constants.js';
import { TopicService } from './topic.service.js';

/**
 * 议题服务（模块 7）
 *
 * 这份断言保护两处容易被「看起来能跑」掩盖的地方：
 *   ① **报告页议题包入口**：列表必须下发 `mountDimensions`（规范增补一 §三「每个待沟通区
 *      → 对应议题包入口」）—— 缺了它报告页只能逐议题调详情，或把映射抄进端上；
 *   ② **续看进度**：端上报是**单调不减**的（滑回上一张卡不应把续看位置退回去），
 *      `finished` 一经打卡不可取消，且无变化时不写库（滑动上报频繁，避免无谓行更新）。
 */
describe('TopicService 议题列表与阅读进度', () => {
  const USER_ID = 7;

  const topicRepository = {
    find: vi.fn(),
    findOne: vi.fn(),
    save: vi.fn(),
  };
  const cardRepository = {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((input: unknown) => ({ ...(input as object) })),
    save: vi.fn(),
  };
  const progressRepository = {
    find: vi.fn(),
    findOne: vi.fn(),
    save: vi.fn(),
    create: vi.fn((input: unknown) => ({ ...(input as object) })),
    update: vi.fn(),
  };
  const entitlementService = { topicSet: vi.fn() };
  const exclusiveCardService = { read: vi.fn() };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const buildService = (): TopicService =>
    new TopicService(
      topicRepository as unknown as Repository<TopicEntity>,
      cardRepository as unknown as Repository<TopicCardEntity>,
      progressRepository as unknown as Repository<TopicReadProgressEntity>,
      entitlementService as unknown as EntitlementService,
      exclusiveCardService as unknown as ExclusiveCardService,
      logger as unknown as AppLogger,
    );

  const makeTopic = (overrides: Partial<TopicEntity> = {}): TopicEntity =>
    ({
      id: 21,
      code: 'long_distance',
      title: '异地安排',
      subtitle: '拖到婚前才谈，是最差时机',
      orderNo: 6,
      status: TOPIC_STATUS_ON,
      mountDimensions: ['CAREER', 'INTIMACY'],
      ...overrides,
    }) as TopicEntity;

  const makeCard = (overrides: Partial<TopicCardEntity> = {}): TopicCardEntity =>
    ({
      id: 301,
      topicId: 21,
      orderNo: 3,
      cardType: 'action',
      title: null,
      body: '旧正文',
      copyable: 0,
      optionsJson: null,
      status: TOPIC_STATUS_ON,
      ...overrides,
    }) as TopicCardEntity;

  beforeEach(() => {
    vi.clearAllMocks();
    topicRepository.find.mockResolvedValue([makeTopic()]);
    topicRepository.findOne.mockResolvedValue(makeTopic());
    topicRepository.save.mockImplementation((input: unknown) => Promise.resolve(input));
    cardRepository.find.mockResolvedValue([]);
    cardRepository.findOne.mockResolvedValue(null);
    cardRepository.create.mockImplementation((input: unknown) => ({ ...(input as object) }));
    cardRepository.save.mockImplementation((input: unknown) => Promise.resolve(input));
    progressRepository.find.mockResolvedValue([]);
    progressRepository.findOne.mockResolvedValue(null);
    progressRepository.create.mockImplementation((input: unknown) => ({ ...(input as object) }));
    progressRepository.save.mockImplementation((input: unknown) =>
      Promise.resolve({ id: 1, ...(input as object) }),
    );
    progressRepository.update.mockResolvedValue({ affected: 1 });
    entitlementService.topicSet.mockResolvedValue(new Set<string>());
    exclusiveCardService.read.mockResolvedValue({
      locked: true,
      price: 6,
      ready: false,
      content: null,
      generatedAt: null,
    });
  });

  describe('列表（报告页议题包入口的数据来源）', () => {
    it('下发挂载维度、解锁态与续看位置', async () => {
      entitlementService.topicSet.mockResolvedValue(new Set(['long_distance']));
      progressRepository.find.mockResolvedValue([
        { userId: USER_ID, topicId: 21, lastOrderNo: 4, finished: 1 },
      ]);

      const [item] = await buildService().list(USER_ID);

      expect(item).toEqual({
        code: 'long_distance',
        title: '异地安排',
        subtitle: '拖到婚前才谈，是最差时机',
        unlocked: true,
        lastOrderNo: 4,
        finished: true,
        mountDimensions: ['CAREER', 'INTIMACY'],
      });
    });

    it('只取在架议题，并按 orderNo 升序', async () => {
      await buildService().list(USER_ID);

      expect(topicRepository.find).toHaveBeenCalledWith({
        where: { status: TOPIC_STATUS_ON },
        order: { orderNo: 'ASC' },
      });
    });

    it('无在架议题时不再查权益与进度（空列表直接返回）', async () => {
      topicRepository.find.mockResolvedValue([]);

      const result = await buildService().list(USER_ID);

      expect(result).toEqual([]);
      expect(entitlementService.topicSet).not.toHaveBeenCalled();
      expect(progressRepository.find).not.toHaveBeenCalled();
    });

    it('未读过议题时 lastOrderNo=0、finished=false、mountDimensions 缺列兜底为空数组', async () => {
      topicRepository.find.mockResolvedValue([
        makeTopic({ mountDimensions: null as unknown as string[] }),
      ]);

      const [item] = await buildService().list(USER_ID);

      expect(item).toMatchObject({ lastOrderNo: 0, finished: false, mountDimensions: [] });
    });
  });

  describe('详情（requireActiveByCode）', () => {
    it('议题不存在 → 50001', async () => {
      topicRepository.findOne.mockResolvedValue(null);

      await expect(buildService().getDetail(USER_ID, 'nope')).rejects.toMatchObject({
        response: { code: ErrorCode.TOPIC_NOT_FOUND },
      });
    });

    it('议题已下架 → 50002（与「不存在」分开，便于客服判断该重进还是等上架）', async () => {
      topicRepository.findOne.mockResolvedValue(makeTopic({ status: TOPIC_STATUS_OFF }));

      await expect(buildService().getDetail(USER_ID, 'long_distance')).rejects.toMatchObject({
        response: { code: ErrorCode.TOPIC_OFFLINE },
      });
    });

    it('卡片流只取在架卡片、按 orderNo 升序，并带出专属卡状态', async () => {
      cardRepository.find.mockResolvedValue([
        {
          orderNo: 0,
          cardType: 'script',
          title: '对伴侣，摸底',
          body: '……',
          copyable: 1,
          optionsJson: null,
        },
      ]);

      const detail = await buildService().getDetail(USER_ID, 'long_distance');

      expect(cardRepository.find).toHaveBeenCalledWith({
        where: { topicId: 21, status: TOPIC_STATUS_ON },
        order: { orderNo: 'ASC' },
      });
      expect(detail.cards).toEqual([
        {
          orderNo: 0,
          type: 'script',
          title: '对伴侣，摸底',
          body: '……',
          copyable: true,
          options: null,
        },
      ]);
      expect(detail.mountDimensions).toEqual(['CAREER', 'INTIMACY']);
      expect(detail.exclusiveCard).toMatchObject({ locked: true, price: 6 });
    });
  });

  describe('阅读进度上报（单调不减 + 打卡不可取消）', () => {
    it('端上报更小的卡序不覆盖既有进度，返回服务端既有值', async () => {
      progressRepository.findOne.mockResolvedValue({
        id: 5,
        userId: USER_ID,
        topicId: 21,
        lastOrderNo: 4,
        finished: 0,
      });

      const ack = await buildService().saveProgress(USER_ID, 'long_distance', { lastOrderNo: 1 });

      expect(ack).toEqual({ code: 'long_distance', lastOrderNo: 4, finished: false });
      expect(progressRepository.update).not.toHaveBeenCalled();
    });

    it('推进卡序时写库；已打卡后不再被取消', async () => {
      progressRepository.findOne.mockResolvedValue({
        id: 5,
        userId: USER_ID,
        topicId: 21,
        lastOrderNo: 3,
        finished: 1,
      });

      const ack = await buildService().saveProgress(USER_ID, 'long_distance', {
        lastOrderNo: 5,
        finished: false,
      });

      expect(progressRepository.update).toHaveBeenCalledWith(
        { id: 5 },
        { lastOrderNo: 5, finished: 1 },
      );
      expect(ack).toEqual({ code: 'long_distance', lastOrderNo: 5, finished: true });
    });

    it('首次上报即建行', async () => {
      await buildService().saveProgress(USER_ID, 'long_distance', { lastOrderNo: 2 });

      expect(progressRepository.save).toHaveBeenCalledWith({
        userId: USER_ID,
        topicId: 21,
        lastOrderNo: 2,
        finished: 0,
      });
    });
  });

  /**
   * 后台（CMS）读写（模块 7 后台切片的原子能力）
   *
   * 保护两处「不报错但会把内容写坏」的数据层规则：
   *   ① 新增卡片的卡序由服务端追加到末尾（端上进度与卡序强相关，撞序会让进度错位）
   *   ② 改卡序撞到已占用的位置必须拒绝（`topic_card` 只有普通索引，数据库不兜底）
   * 另锁一条运营可用性：**已下架议题仍可编辑**（否则一下架就失联，只能改库恢复）。
   */
  describe('后台（CMS）读写', () => {
    const cardInput = {
      type: 'action',
      body: '今晚先做一件小事：把"你怎么又不理我"换成"我想你了"',
      title: null,
      copyable: false,
      options: null,
    };

    it('新增卡片：卡序追加到末尾（不接受调用方指定）', async () => {
      cardRepository.findOne.mockResolvedValue(makeCard({ id: 9, orderNo: 7 }));

      await buildService().createCardForAdmin('long_distance', cardInput);

      expect(cardRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 21, orderNo: 8, cardType: 'action', status: TOPIC_STATUS_ON }),
      );
    });

    it('新增卡片：议题下尚无卡片时从 1 起（与种子数据的卡序口径一致）', async () => {
      cardRepository.findOne.mockResolvedValue(null);

      await buildService().createCardForAdmin('long_distance', cardInput);

      expect(cardRepository.save).toHaveBeenCalledWith(expect.objectContaining({ orderNo: 1 }));
    });

    it('新增卡片：议题不存在 → 50001 且不写库（脏链接不该悄悄建内容）', async () => {
      topicRepository.findOne.mockResolvedValue(null);

      await expect(buildService().createCardForAdmin('nope', cardInput)).rejects.toMatchObject({
        response: { code: ErrorCode.TOPIC_NOT_FOUND },
      });
      expect(cardRepository.save).not.toHaveBeenCalled();
    });

    it('编辑卡片：卡序撞到已占用的位置 → 10001 且不写库', async () => {
      cardRepository.findOne.mockResolvedValue(makeCard({ id: 99, orderNo: 5 }));

      await expect(
        buildService().updateCardForAdmin('long_distance', makeCard({ orderNo: 3 }), { orderNo: 5 }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(cardRepository.save).not.toHaveBeenCalled();
    });

    it('编辑卡片：卡序改到空位 → 落库，且 before 保留原值', async () => {
      cardRepository.findOne.mockResolvedValue(null);

      const { before, after } = await buildService().updateCardForAdmin(
        'long_distance',
        makeCard({ orderNo: 3 }),
        { orderNo: 5, body: '新正文' },
      );

      expect(before).toMatchObject({ orderNo: 3, body: '旧正文' });
      expect(after).toMatchObject({ orderNo: 5, body: '新正文' });
    });

    it('编辑卡片：卡序不变时不查占用（避免一次无谓查询）', async () => {
      await buildService().updateCardForAdmin('long_distance', makeCard({ orderNo: 3 }), {
        orderNo: 3,
        title: '对伴侣，摸底',
      });

      expect(cardRepository.findOne).not.toHaveBeenCalled();
    });

    it('编辑议题：已下架议题同样可编辑（否则下架即失联，连重新上架都做不到）', async () => {
      topicRepository.findOne.mockResolvedValue(makeTopic({ status: TOPIC_STATUS_OFF }));

      const { before, after } = await buildService().updateForAdmin('long_distance', {
        status: TOPIC_STATUS_ON,
      });

      expect(before.status).toBe(TOPIC_STATUS_OFF);
      expect(after.status).toBe(TOPIC_STATUS_ON);
    });

    it('编辑议题：议题不存在 → 50001', async () => {
      topicRepository.findOne.mockResolvedValue(null);

      await expect(
        buildService().updateForAdmin('nope', { title: '新标题' }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.TOPIC_NOT_FOUND } });
      expect(topicRepository.save).not.toHaveBeenCalled();
    });
  });
});
