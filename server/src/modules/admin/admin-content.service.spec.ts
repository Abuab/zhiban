import type { AdminUser } from '../../common/types/request-context.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import type { TopicCardEntity } from '../topic/entities/topic-card.entity.js';
import type { TopicEntity } from '../topic/entities/topic.entity.js';
import {
  CARD_TYPE_ACTION,
  CARD_TYPE_PITFALL,
  CARD_TYPE_QUIZ,
  CARD_TYPE_SCRIPT,
} from '../topic/topic.constants.js';
import { TopicService, toTopicCardSnapshot, toTopicSnapshot } from '../topic/topic.service.js';
import { AdminContentService } from './admin-content.service.js';

/**
 * 后台内容域写操作（模块 7 后台切片）
 *
 * 这份断言保护两类「看起来能跑但会把内容写坏」的情形：
 *   ① **语义校验**：未知卡类型 / 非真实挂载维度 / 演练卡选项结构错（正确答案不是恰好一个、
 *      key 重复、correct 不是布尔）—— 这些若静默写进库，端上会渲染空白卡或错误判分，
 *      且没有任何报错线索（G1 验收要求运营改内容无需发版，也就意味着没人会再跑一遍种子校验）
 *   ② **审计留痕**：每次有效写入都必须带 before/after，否则「谁把锦囊改坏了」无从追查
 */
describe('AdminContentService 内容域写操作', () => {
  const admin = {
    id: 7,
    username: 'ops',
    role: 'super',
    sessionId: 's1',
    totpEnabled: true,
  } as AdminUser;
  const meta = { ip: '198.51.100.7', userAgent: 'vitest' };

  const topicService = {
    listForAdmin: vi.fn(),
    findByCodeForAdmin: vi.fn(),
    updateForAdmin: vi.fn(),
    findCardsForAdmin: vi.fn(),
    findCardForAdmin: vi.fn(),
    createCardForAdmin: vi.fn(),
    updateCardForAdmin: vi.fn(),
  };
  const auditLog = { record: vi.fn() };

  const buildService = (): AdminContentService =>
    new AdminContentService(
      topicService as unknown as TopicService,
      auditLog as unknown as AuditLogService,
    );

  const topic = (overrides: Partial<TopicEntity> = {}): TopicEntity =>
    ({
      id: 21,
      code: 'cold_war',
      title: '冷战修复',
      subtitle: '暂停可以，停战要有期限',
      mountDimensions: ['COMMUNICATION'],
      orderNo: 5,
      status: 'on',
      ...overrides,
    }) as TopicEntity;

  const card = (overrides: Partial<TopicCardEntity> = {}): TopicCardEntity =>
    ({
      id: 301,
      topicId: 21,
      orderNo: 3,
      cardType: CARD_TYPE_SCRIPT,
      title: '对伴侣，摸底',
      body: '旧正文',
      copyable: 1,
      optionsJson: null,
      status: 'on',
      ...overrides,
    }) as TopicCardEntity;

  const quizOptions = (): unknown[] => [
    { key: 'A', text: '先开口算输', correct: false, explain: '先开口是修复，不是认输' },
    { key: 'B', text: '等对方先开口', correct: true, explain: '等待会把冷战拖成习惯' },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    topicService.updateForAdmin.mockImplementation((_code: string, patch: Partial<TopicEntity>) =>
      Promise.resolve({ before: toTopicSnapshot(topic()), after: topic(patch) }),
    );
    topicService.createCardForAdmin.mockImplementation(
      (
        _code: string,
        input: {
          type: string;
          body: string;
          title: string | null;
          copyable: boolean;
          options: TopicCardEntity['optionsJson'];
        },
      ) =>
        Promise.resolve(
          card({
            cardType: input.type,
            body: input.body,
            title: input.title,
            copyable: input.copyable ? 1 : 0,
            optionsJson: input.options,
          }),
        ),
    );
    topicService.findCardForAdmin.mockResolvedValue(card());
    topicService.updateCardForAdmin.mockImplementation(
      (_code: string, _card: TopicCardEntity, patch: Partial<TopicCardEntity>) =>
        Promise.resolve({ before: toTopicCardSnapshot(card()), after: card(patch) }),
    );
    auditLog.record.mockResolvedValue(undefined);
  });

  describe('编辑议题', () => {
    it('挂载维度必须是真实量表维度编码 → 否则 10001（脏维度会让报告入口永远匹配不上）', async () => {
      await expect(
        buildService().updateTopic('cold_war', { mountDimensions: ['NOT_A_DIMENSION'] }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.updateForAdmin).not.toHaveBeenCalled();
    });

    it('挂载维度去重后下发（重复项对入口映射无意义，只会留脏数据）', async () => {
      await buildService().updateTopic(
        'cold_war',
        { mountDimensions: ['COMMUNICATION', 'COMMUNICATION', 'FINANCE'] },
        admin,
        meta,
      );

      expect(topicService.updateForAdmin).toHaveBeenCalledWith('cold_war', {
        mountDimensions: ['COMMUNICATION', 'FINANCE'],
      });
    });

    it('副标题传空串 → 落 null（避免库里出现空串与 null 两种「没有副标题」）', async () => {
      await buildService().updateTopic('cold_war', { subtitle: '   ' }, admin, meta);

      expect(topicService.updateForAdmin).toHaveBeenCalledWith('cold_war', { subtitle: null });
    });

    it('标题为空白 → 10001 且不写库', async () => {
      await expect(
        buildService().updateTopic('cold_war', { title: '  ' }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.updateForAdmin).not.toHaveBeenCalled();
    });

    it('未提供任何字段 → 10001（避免一次无意义的空写）', async () => {
      await expect(buildService().updateTopic('cold_war', {}, admin, meta)).rejects.toMatchObject({
        response: { code: ErrorCode.PARAM_INVALID },
      });
      expect(topicService.updateForAdmin).not.toHaveBeenCalled();
    });

    it('写入成功 → 审计带 before/after 与议题编码', async () => {
      await buildService().updateTopic('cold_war', { status: 'off' }, admin, meta);

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'admin',
          actorId: 7,
          action: AuditAction.TOPIC_UPDATE,
          targetType: 'topic',
          targetId: 'cold_war',
          ip: meta.ip,
          detail: expect.objectContaining({
            before: expect.objectContaining({ title: '冷战修复', subtitle: '暂停可以，停战要有期限' }),
            after: expect.objectContaining({ status: 'off' }),
          }),
        }),
      );
    });
  });

  describe('新增卡片', () => {
    const validInput = {
      type: CARD_TYPE_PITFALL,
      body: '饭桌上长辈刚提彩礼，你抢着说……',
    };

    it('未知卡类型 → 10001（端上不认识该类型，卡会渲染成空白）', async () => {
      await expect(
        buildService().createCard('cold_war', { ...validInput, type: 'video' }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.createCardForAdmin).not.toHaveBeenCalled();
    });

    it('正文为空白 → 10001', async () => {
      await expect(
        buildService().createCard('cold_war', { ...validInput, body: '   ' }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('非话术卡勾选可复制 → 10001（只有话术卡支持长按复制，§9.4）', async () => {
      await expect(
        buildService().createCard('cold_war', { ...validInput, copyable: true }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.createCardForAdmin).not.toHaveBeenCalled();
    });

    it('话术卡可复制 → 落 1（copyable 传布尔，由服务层决定落库值）', async () => {
      await buildService().createCard(
        'cold_war',
        { type: CARD_TYPE_SCRIPT, body: '你说……', copyable: true },
        admin,
        meta,
      );

      expect(topicService.createCardForAdmin).toHaveBeenCalledWith(
        'cold_war',
        expect.objectContaining({ type: CARD_TYPE_SCRIPT, copyable: true, options: null }),
      );
    });

    it('演练卡未给选项 → 10001（端上无法作答）', async () => {
      await expect(
        buildService().createCard(
          'cold_war',
          { type: CARD_TYPE_QUIZ, body: '他三天没理你，你先开口算输吗？' },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('非演练卡给了选项 → 10001（内容会丢失：端上不渲染非演练卡的 options）', async () => {
      await expect(
        buildService().createCard('cold_war', { ...validInput, options: quizOptions() }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('演练卡的两个正确答案 → 10001；零个正确答案 → 10001', async () => {
      const twoCorrect = [
        { key: 'A', text: '甲', correct: true, explain: '解析甲' },
        { key: 'B', text: '乙', correct: true, explain: '解析乙' },
      ];
      const noneCorrect = twoCorrect.map((option) => ({ ...option, correct: false }));

      const service = buildService();
      await expect(
        service.createCard(
          'cold_war',
          { type: CARD_TYPE_QUIZ, body: '题干', options: twoCorrect },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      await expect(
        service.createCard(
          'cold_war',
          { type: CARD_TYPE_QUIZ, body: '题干', options: noneCorrect },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('选项 key 重复 → 10001（作答记录无法定位到选中的是哪一个）', async () => {
      await expect(
        buildService().createCard(
          'cold_war',
          {
            type: CARD_TYPE_QUIZ,
            body: '题干',
            options: [
              { key: 'A', text: '甲', correct: true, explain: '解析甲' },
              { key: 'A', text: '乙', correct: false, explain: '解析乙' },
            ],
          },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('选项缺少解析 / correct 不是布尔 → 10001（端上解析条会空着、判分失效）', async () => {
      const service = buildService();
      await expect(
        service.createCard(
          'cold_war',
          {
            type: CARD_TYPE_QUIZ,
            body: '题干',
            options: [
              { key: 'A', text: '甲', correct: true, explain: '' },
              { key: 'B', text: '乙', correct: false, explain: '解析乙' },
            ],
          },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      await expect(
        service.createCard(
          'cold_war',
          {
            type: CARD_TYPE_QUIZ,
            body: '题干',
            options: [
              { key: 'A', text: '甲', correct: 'yes', explain: '解析甲' },
              { key: 'B', text: '乙', correct: false, explain: '解析乙' },
            ],
          },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('选项正文超长（>120 字）→ 10001', async () => {
      await expect(
        buildService().createCard(
          'cold_war',
          {
            type: CARD_TYPE_QUIZ,
            body: '题干',
            options: [
              { key: 'A', text: '甲'.repeat(121), correct: true, explain: '解析甲' },
              { key: 'B', text: '乙', correct: false, explain: '解析乙' },
            ],
          },
          admin,
          meta,
        ),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
    });

    it('新增成功 → 审计记 TOPIC_CARD_CREATE，targetId 为 `议题#卡序`', async () => {
      await buildService().createCard(
        'cold_war',
        { type: CARD_TYPE_ACTION, body: '今晚先做一件小事：……' },
        admin,
        meta,
      );

      // 精确匹配入参（不含卡序）：卡序由服务端追加到末尾，不接受运营指定
      expect(topicService.createCardForAdmin).toHaveBeenCalledWith('cold_war', {
        type: CARD_TYPE_ACTION,
        body: '今晚先做一件小事：……',
        title: null,
        copyable: false,
        options: null,
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.TOPIC_CARD_CREATE,
          targetType: 'topic_card',
          targetId: 'cold_war#3',
          detail: expect.objectContaining({
            after: expect.objectContaining({ orderNo: 3, type: CARD_TYPE_ACTION }),
          }),
        }),
      );
    });
  });

  describe('编辑卡片', () => {
    it('卡片不存在 → 透传 10002（由 TopicService.findCardForAdmin 判定）', async () => {
      topicService.findCardForAdmin.mockRejectedValue(
        Object.assign(new Error('卡片不存在'), { response: { code: ErrorCode.RESOURCE_NOT_FOUND } }),
      );

      await expect(
        buildService().updateCard('cold_war', 99, { body: '新正文' }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.RESOURCE_NOT_FOUND } });
      expect(topicService.updateCardForAdmin).not.toHaveBeenCalled();
    });

    it('坑卡勾选可复制 → 10001（类型不可改，故校验依据既有卡类型）', async () => {
      topicService.findCardForAdmin.mockResolvedValue(card({ cardType: CARD_TYPE_PITFALL }));

      await expect(
        buildService().updateCard('cold_war', 3, { copyable: true }, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.updateCardForAdmin).not.toHaveBeenCalled();
    });

    it('未提供任何字段 → 10001', async () => {
      await expect(
        buildService().updateCard('cold_war', 3, {}, admin, meta),
      ).rejects.toMatchObject({ response: { code: ErrorCode.PARAM_INVALID } });
      expect(topicService.updateCardForAdmin).not.toHaveBeenCalled();
    });

    it('编辑成功 → 审计带 before/after 与卡序', async () => {
      await buildService().updateCard('cold_war', 3, { body: '新正文', status: 'off' }, admin, meta);

      expect(topicService.updateCardForAdmin).toHaveBeenCalledWith(
        'cold_war',
        expect.objectContaining({ orderNo: 3 }),
        { body: '新正文', status: 'off' },
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.TOPIC_CARD_UPDATE,
          targetId: 'cold_war#3',
          detail: expect.objectContaining({
            before: expect.objectContaining({ body: '旧正文' }),
            after: expect.objectContaining({ body: '新正文' }),
          }),
        }),
      );
    });
  });
});
