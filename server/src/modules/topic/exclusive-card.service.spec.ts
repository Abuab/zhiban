import type { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import { AssessmentService } from '../assessment/assessment.service.js';
import type { SheetScoresCache } from '../assessment/assessment.types.js';
import { SensitiveWordService } from '../content/sensitive-word.service.js';
import { InviteService } from '../invite/invite.service.js';
import type { ReadyDoubleReportSource } from '../invite/invite.types.js';
import { EntitlementService } from '../payment/entitlement.service.js';
import { ProductService } from '../payment/product.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ExclusiveCardEntity } from './entities/exclusive-card.entity.js';
import { TopicCardEntity } from './entities/topic-card.entity.js';
import { TopicEntity } from './entities/topic.entity.js';
import { ExclusiveCardService } from './exclusive-card.service.js';
import { LlmService } from './llm.service.js';
import {
  EXCLUSIVE_CARD_LOCK_TTL_SEC,
  EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE,
  EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA,
  EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED,
  EXCLUSIVE_CARD_SOLO_INVITE_ID,
  EXCLUSIVE_CARD_STATUS_DEGRADED,
  EXCLUSIVE_CARD_STATUS_READY,
  EXCLUSIVE_CARD_STATUS_REJECTED,
  PROMPT_VERSION_DUO,
  PROMPT_VERSION_SOLO,
} from './topic.constants.js';

/**
 * 专属卡服务（模块 7，§9 + ADR-007 决策 4 + ADR-008）
 *
 * 这份断言保护两类东西，都不能靠「跑起来看看」发现：
 *   ① **钱与权益**：未解锁绝不能下发 `content`（付费墙在服务端），无权益不得触发生成；
 *   ② **隐私**：单人卡的缓存归属必须带 `owner_uid`（ADR-008 决策 5），
 *      否则全站单人用户在同一议题共用一行 → 用户会看到别人的专属建议。
 * 其余覆盖生成编排：禁词重试 1 次、降级拼装、模型未配置降级、数据不足降级、并发锁、缓存幂等。
 */
describe('ExclusiveCardService 专属卡生成编排', () => {
  const USER_ID = 7;
  const OTHER_USER_ID = 9;

  const topic = {
    id: 21,
    code: 'cold_war',
    title: '冷战修复',
    mountDimensions: ['COMMUNICATION'],
  } as TopicEntity;

  /** 单人答卷缓存（只有 COMMUNICATION 已评估） */
  const singleCache = {
    dimensions: [
      { code: 'COMMUNICATION', name: '沟通模式', evaluated: true, score: 62.5, supplemented: false },
      { code: 'FINANCE', name: '财务观', evaluated: false, score: null, supplemented: false },
    ],
  } as unknown as SheetScoresCache;

  const cardRepository = {
    findOne: vi.fn(),
    create: vi.fn((input: unknown) => ({ ...(input as object) })),
    save: vi.fn((input: unknown) => Promise.resolve({ id: 501, ...(input as object) })),
  };
  const topicCardRepository = { find: vi.fn() };
  const assessmentService = { findLatestSubmittedSheet: vi.fn() };
  const inviteService = { findLatestReadyDoubleReport: vi.fn() };
  const entitlementService = { hasTopic: vi.fn() };
  const productService = { findByCode: vi.fn() };
  const sensitiveWordService = { match: vi.fn() };
  const llmService = { configured: true, complete: vi.fn() };
  const redisService = { setIfAbsent: vi.fn(), del: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const buildService = (): ExclusiveCardService =>
    new ExclusiveCardService(
      cardRepository as unknown as Repository<ExclusiveCardEntity>,
      topicCardRepository as unknown as Repository<TopicCardEntity>,
      assessmentService as unknown as AssessmentService,
      inviteService as unknown as InviteService,
      entitlementService as unknown as EntitlementService,
      productService as unknown as ProductService,
      sensitiveWordService as unknown as SensitiveWordService,
      llmService as unknown as LlmService,
      redisService as unknown as RedisService,
      auditLogService as unknown as AuditLogService,
      logger as unknown as AppLogger,
    );

  /** 最近一次 `cardRepository.save` 的入参（落库断言统一走它） */
  const lastSavedCard = (): Record<string, unknown> =>
    cardRepository.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    cardRepository.findOne.mockResolvedValue(null);
    cardRepository.create.mockImplementation((input: unknown) => ({ ...(input as object) }));
    cardRepository.save.mockImplementation((input: unknown) =>
      Promise.resolve({ id: 501, ...(input as object) }),
    );
    topicCardRepository.find.mockResolvedValue([]);
    assessmentService.findLatestSubmittedSheet.mockResolvedValue(null);
    inviteService.findLatestReadyDoubleReport.mockResolvedValue(null);
    entitlementService.hasTopic.mockResolvedValue(true);
    productService.findByCode.mockResolvedValue({ status: 'on', price: 6 });
    sensitiveWordService.match.mockResolvedValue(null);
    llmService.configured = true;
    llmService.complete.mockResolvedValue({ content: '模型生成的专属建议', model: 'deepseek-chat' });
    redisService.setIfAbsent.mockResolvedValue(true);
    redisService.del.mockResolvedValue(undefined);
    auditLogService.record.mockResolvedValue(undefined);
  });

  describe('读取（付费墙与降级不外显）', () => {
    it('未解锁时 locked=true、下发价格，且 content 恒为 null（付费墙在服务端）', async () => {
      entitlementService.hasTopic.mockResolvedValue(false);
      cardRepository.findOne.mockResolvedValue({ content: '已生成的付费内容', generatedAt: new Date() });

      const view = await buildService().read(USER_ID, topic);

      expect(view).toEqual({
        locked: true,
        price: 6,
        ready: false,
        content: null,
        generatedAt: null,
      });
    });

    it('已解锁且有内容时下发 content 与生成时间、price 为 null', async () => {
      const generatedAt = new Date('2026-09-19T10:00:00.000Z');
      cardRepository.findOne.mockResolvedValue({ content: '专属建议', generatedAt });

      const view = await buildService().read(USER_ID, topic);

      expect(view.locked).toBe(false);
      expect(view.price).toBeNull();
      expect(view.ready).toBe(true);
      expect(view.content).toBe('专属建议');
      expect(view.generatedAt).toBe(generatedAt.toISOString());
    });

    it('已解锁但尚无内容时 ready=false（端上显示「生成」按钮）', async () => {
      const view = await buildService().read(USER_ID, topic);

      expect(view).toMatchObject({ locked: false, ready: false, content: null, generatedAt: null });
    });

    it('商品缺失 / 已下架时价格下发 null（不展示 ¥0 误导下单）', async () => {
      entitlementService.hasTopic.mockResolvedValue(false);
      productService.findByCode.mockResolvedValue(null);

      const view = await buildService().read(USER_ID, topic);

      expect(view.price).toBeNull();
    });
  });

  describe('生成（权益与幂等）', () => {
    it('未持有议题权益时拒绝生成（端上传参无法绕过）', async () => {
      entitlementService.hasTopic.mockResolvedValue(false);

      await expect(
        buildService().generate(USER_ID, topic, { ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.ENTITLEMENT_REQUIRED } });
      expect(llmService.complete).not.toHaveBeenCalled();
    });

    it('已有内容时直读缓存：不调模型、不抢锁（幂等，不重复计费）', async () => {
      cardRepository.findOne.mockResolvedValue({ content: '缓存的专属建议', generatedAt: new Date() });

      const view = await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(view.content).toBe('缓存的专属建议');
      expect(llmService.complete).not.toHaveBeenCalled();
      expect(redisService.setIfAbsent).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('并发抢不到锁时返回 50004，且不调用模型', async () => {
      redisService.setIfAbsent.mockResolvedValue(false);

      await expect(
        buildService().generate(USER_ID, topic, { ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.EXCLUSIVE_CARD_GENERATING } });
      expect(llmService.complete).not.toHaveBeenCalled();
      // 没抢到锁就不能释放别人的锁
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('单人版：落库归属为本人 + inviteId=0，成功后释放锁并记审计', async () => {
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );

      await buildService().generate(USER_ID, topic, { ip: '1.2.3.4', userAgent: 'wx' });

      expect(lastSavedCard()).toMatchObject({
        ownerUid: USER_ID,
        inviteId: EXCLUSIVE_CARD_SOLO_INVITE_ID,
        topicId: topic.id,
        requesterUid: USER_ID,
        status: EXCLUSIVE_CARD_STATUS_READY,
        promptVersion: PROMPT_VERSION_SOLO,
        content: '模型生成的专属建议',
      });
      expect(redisService.setIfAbsent).toHaveBeenCalledWith(
        expect.stringContaining(`:${USER_ID}:0:${topic.id}`),
        String(USER_ID),
        EXCLUSIVE_CARD_LOCK_TTL_SEC,
      );
      expect(redisService.del).toHaveBeenCalledTimes(1);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'user',
          actorId: USER_ID,
          action: AuditAction.EXCLUSIVE_CARD_GENERATE,
          targetType: 'exclusive_card',
          detail: expect.objectContaining({
            inviteId: 0,
            topicCode: 'cold_war',
            promptVersion: PROMPT_VERSION_SOLO,
            status: EXCLUSIVE_CARD_STATUS_READY,
          }),
          ip: '1.2.3.4',
          userAgent: 'wx',
        }),
      );
    });

    it('两个单人用户在同一议题上各自成行（owner_uid 隔离，不串号）', async () => {
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );

      await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });
      await buildService().generate(OTHER_USER_ID, topic, { ip: '1.2.3.5' });

      const [first, second] = cardRepository.save.mock.calls.map(
        (call) => call[0] as Record<string, unknown>,
      );
      expect(first?.ownerUid).toBe(USER_ID);
      expect(second?.ownerUid).toBe(OTHER_USER_ID);
    });
  });

  describe('生成（禁词校验与重试）', () => {
    it('首次命中禁词、重试通过：落库 ready 且 attempts=2、记录命中词', async () => {
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );
      sensitiveWordService.match
        .mockResolvedValueOnce('赌博')
        .mockResolvedValueOnce(null);

      await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(llmService.complete).toHaveBeenCalledTimes(2);
      expect(lastSavedCard()).toMatchObject({
        status: EXCLUSIVE_CARD_STATUS_READY,
        content: '模型生成的专属建议',
        checkResult: { passed: true, hits: ['赌博'], attempts: 2 },
      });
    });

    it('两次都命中禁词：降级为认知卡 + 行动卡拼装，原文不落库', async () => {
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );
      sensitiveWordService.match.mockResolvedValue('劝分');
      topicCardRepository.find.mockResolvedValue([
        { orderNo: 6, body: '冷战不是惩罚，是暂停。' },
        { orderNo: 7, body: '今晚先说一句「我在」，再谈事。' },
      ]);

      const view = await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(llmService.complete).toHaveBeenCalledTimes(2);
      expect(lastSavedCard()).toMatchObject({
        status: EXCLUSIVE_CARD_STATUS_DEGRADED,
        content: '冷战不是惩罚，是暂停。\n今晚先说一句「我在」，再谈事。',
        checkResult: {
          passed: false,
          hits: ['劝分'],
          attempts: 2,
          reason: EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED,
        },
      });
      // 降级内容照常下发（端上不显示「生成失败」，ADR-008 §九）
      expect(view.ready).toBe(true);
      expect(view.content).toContain('今晚先说一句');
    });
  });

  describe('生成（降级路径）', () => {
    it('模型未配置：直接降级（不产生必然失败的请求），原因 llm_unavailable', async () => {
      llmService.configured = false;
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );
      topicCardRepository.find.mockResolvedValue([{ orderNo: 6, body: '兜底内容' }]);

      await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(llmService.complete).not.toHaveBeenCalled();
      expect(lastSavedCard()).toMatchObject({
        status: EXCLUSIVE_CARD_STATUS_DEGRADED,
        checkResult: { passed: false, attempts: 0, reason: EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE },
      });
    });

    it('无已交卷答卷（无维度数据）：降级且原因 no_dimension_data', async () => {
      topicCardRepository.find.mockResolvedValue([{ orderNo: 6, body: '兜底内容' }]);

      await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(llmService.complete).not.toHaveBeenCalled();
      expect(lastSavedCard()).toMatchObject({
        status: EXCLUSIVE_CARD_STATUS_DEGRADED,
        checkResult: { passed: false, attempts: 0, reason: EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA },
      });
    });

    it('议题连认知/行动卡都没有：不落库（避免「无内容且永不重试」的死角）', async () => {
      llmService.configured = false;
      assessmentService.findLatestSubmittedSheet.mockImplementation((_uid: number, scene: string) =>
        Promise.resolve(scene === 'single' ? { cache: singleCache } : null),
      );
      topicCardRepository.find.mockResolvedValue([]);

      const view = await buildService().generate(USER_ID, topic, { ip: '1.2.3.4' });

      expect(cardRepository.save).not.toHaveBeenCalled();
      expect(view).toMatchObject({ ready: false, content: null });
      // 仍然留痕（生成行为已发生）
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({ status: EXCLUSIVE_CARD_STATUS_REJECTED }),
        }),
      );
    });
  });

  describe('生成（双人版取数口径）', () => {
    const duoSource: ReadyDoubleReportSource = {
      inviteId: 33,
      initiatorUid: 8,
      inviteeUid: 9,
      scaleVersionId: 2,
      dimensionScores: {
        dimensions: [
          { dimensionCode: 'CAREER', dimensionName: '职业规划', scoreA: 40, scoreB: 90 },
          { dimensionCode: 'COMMUNICATION', dimensionName: '沟通模式', scoreA: 70, scoreB: 72 },
        ],
        unevaluated: [],
      },
      flagged: {
        scale: [
          {
            questionCode: 'Q12',
            questionTitle: '关于未来两年的生活重心',
            dimensionCode: 'CAREER',
            dimensionName: '职业规划',
            kind: 'scale_gap',
            gap: 4,
            scoreA: 1,
            scoreB: 5,
            optionLabelA: '很不同意',
            optionLabelB: '很同意',
          },
        ],
        choice: [],
      },
    };

    it('选差值最大的挂载维度，并把归属落在邀请发起方（双方共享同一张卡）', async () => {
      inviteService.findLatestReadyDoubleReport.mockResolvedValue(duoSource);
      // 议题同时挂 CAREER 与 COMMUNICATION，CAREER 差值更大
      const multiTopic = {
        ...topic,
        mountDimensions: ['COMMUNICATION', 'CAREER'],
      } as TopicEntity;

      await buildService().generate(8, multiTopic, { ip: '1.2.3.4' });

      const messages = llmService.complete.mock.calls[0]?.[0] as Array<{ content: string }>;
      const userMessage = messages[1]?.content ?? '';
      expect(userMessage).toContain('甲方 40.0/100');
      expect(userMessage).toContain('乙方 90.0/100');
      expect(userMessage).toContain('关于未来两年的生活重心');
      expect(lastSavedCard()).toMatchObject({
        ownerUid: duoSource.initiatorUid,
        inviteId: duoSource.inviteId,
        requesterUid: 8,
        promptVersion: PROMPT_VERSION_DUO,
      });
    });

    it('被邀请方点击时同样落在发起方归属（读到的仍是同一张卡）', async () => {
      // 被邀请方（9）也能取到该报告；归属恒取发起方（8）
      inviteService.findLatestReadyDoubleReport.mockResolvedValue(duoSource);
      cardRepository.findOne.mockResolvedValue({
        ownerUid: 8,
        inviteId: 33,
        topicId: topic.id,
        content: '已生成的双方共享卡',
        generatedAt: new Date(),
      });

      const view = await buildService().generate(9, topic, { ip: '1.2.3.4' });

      expect(cardRepository.findOne).toHaveBeenCalledWith({
        where: { ownerUid: 8, inviteId: 33, topicId: topic.id },
      });
      expect(view.content).toBe('已生成的双方共享卡');
      expect(llmService.complete).not.toHaveBeenCalled();
    });

    it('挂载维度全部未评估：降级为通用版并记 no_dimension_data', async () => {
      inviteService.findLatestReadyDoubleReport.mockResolvedValue({
        ...duoSource,
        dimensionScores: { dimensions: [], unevaluated: [{ dimensionCode: 'CAREER', dimensionName: '职业规划' }] },
      });
      topicCardRepository.find.mockResolvedValue([{ orderNo: 6, body: '兜底内容' }]);

      await buildService().generate(8, topic, { ip: '1.2.3.4' });

      expect(llmService.complete).not.toHaveBeenCalled();
      expect(lastSavedCard()).toMatchObject({
        checkResult: { passed: false, attempts: 0, reason: EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA },
      });
    });
  });
});

/** 断言 BusinessException 的业务码（错误码在 error.response.code 上） */
describe('ExclusiveCardService 错误码口径', () => {
  it('业务异常按 error.response.code 暴露（与全站拦截器口径一致）', () => {
    const error = new BusinessException(ErrorCode.EXCLUSIVE_CARD_REJECTED);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.EXCLUSIVE_CARD_REJECTED });
  });
});
