import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  LOW_QUALITY_NOTICE_MESSAGE,
  SCALE_CODE_16P,
  SCALE_CODE_PRE,
} from '../../engines/scale/scale.constants.js';
import { toEngineDimension, toEngineQuestions, toScoringRuleConfig } from '../scale/scale.mapper.js';
import type { ScaleDimensionEntity } from '../scale/entities/scale-dimension.entity.js';
import type { ScaleQuestionEntity } from '../scale/entities/scale-question.entity.js';
import type { ScaleVersionEntity } from '../scale/entities/scale-version.entity.js';
import type { ScoringRuleEntity } from '../scale/entities/scoring-rule.entity.js';
import { ReportTemplateService } from '../report/report-template.service.js';
import { ScaleQueryService, type ScaleBundle } from '../scale/scale-query.service.js';
import { AssessmentService } from './assessment.service.js';
import type { SheetScoresCache } from './assessment.types.js';
import { AnswerSheetEntity } from './entities/answer-sheet.entity.js';

/** 夹具固定值：一次作答锁定的量表版本 */
const SCALE_VERSION_ID = 100;
const OWNER_ID = 7;
const SHEET_ID = 1;

/** 计时基准时间，避免测试依赖真实时钟 */
const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

/**
 * 维度夹具：1 个普通计分维度 + 1 个敏感维度（B7 可跳过）+ 底线题组（不参与维度分）
 */
function makeDimensions(): ScaleDimensionEntity[] {
  return [
    {
      id: 1,
      scaleVersionId: SCALE_VERSION_ID,
      code: 'FINANCE',
      name: '财务观与婚俗财务',
      orderNo: 1,
      isSensitive: 0,
      isScored: 1,
      createdAt: FIXED_NOW,
    },
    {
      id: 2,
      scaleVersionId: SCALE_VERSION_ID,
      code: 'INTIMACY',
      name: '亲密关系',
      orderNo: 2,
      isSensitive: 1,
      isScored: 1,
      createdAt: FIXED_NOW,
    },
    {
      id: 3,
      scaleVersionId: SCALE_VERSION_ID,
      code: 'BASELINE',
      name: '底线题组',
      orderNo: 3,
      isSensitive: 0,
      isScored: 0,
      createdAt: FIXED_NOW,
    },
  ];
}

/** 题目夹具：Q1/Q2 计分维度（Q2 反向）、Q3/Q4 敏感维度、Q5 底线题 */
function makeQuestions(): ScaleQuestionEntity[] {
  const base = {
    scaleVersionId: SCALE_VERSION_ID,
    type: 'scale' as const,
    reverse: 0,
    isStyle: 0,
    isBaseline: 0,
    optionsJson: null,
    extJson: null,
    status: 'on',
    createdAt: FIXED_NOW,
  };
  return [
    { ...base, id: 11, dimensionId: 1, code: 'Q1', orderNo: 1, title: '题目一' },
    { ...base, id: 12, dimensionId: 1, code: 'Q2', orderNo: 2, title: '题目二', reverse: 1 },
    { ...base, id: 13, dimensionId: 2, code: 'Q3', orderNo: 3, title: '题目三' },
    { ...base, id: 14, dimensionId: 2, code: 'Q4', orderNo: 4, title: '题目四' },
    { ...base, id: 15, dimensionId: null, code: 'Q5', orderNo: 5, title: '题目五', isBaseline: 1 },
  ];
}

/** 一次作答所需的量表快照（引擎纯数据由真实映射层生成，保证夹具与线上口径一致） */
function makeBundle(): ScaleBundle {
  const dimensions = makeDimensions();
  const questions = makeQuestions();
  const version = {
    id: SCALE_VERSION_ID,
    scaleId: 1,
    version: '1.0',
    status: 'frozen',
    itemCount: questions.length,
    introText: '以下题目没有对错，请按你的真实想法作答。',
    baselineIntroText: '以下几题关于婚前的事实确认，同样没有对错，请按你的真实想法作答。',
    frozenAt: FIXED_NOW,
    createdBy: null,
    createdAt: FIXED_NOW,
  } as ScaleVersionEntity;
  const scoringRule = {
    id: 1,
    scaleVersionId: SCALE_VERSION_ID,
    aggregateMethod: 'mean_normalized',
    diffThresholdHigh: 15,
    diffThresholdMid: 30,
    labelsJson: { high: '高共识', mid: '待沟通', low: '重点待沟通' },
    qualityMinSec: 180,
    version: '1.0',
    status: 'on',
    updatedBy: null,
    updatedAt: FIXED_NOW,
  } as ScoringRuleEntity;

  return {
    version,
    scale: {
      id: 1,
      code: SCALE_CODE_PRE,
      name: '婚前评估',
      description: null,
      latestVersionId: SCALE_VERSION_ID,
      createdAt: FIXED_NOW,
    },
    dimensions,
    questions,
    scoringRule,
    engineDimensions: dimensions.map(toEngineDimension),
    engineQuestions: toEngineQuestions(questions, dimensions),
    engineRule: toScoringRuleConfig(scoringRule),
  } as ScaleBundle;
}

/** 答题卷夹具 */
function makeSheet(overrides: Partial<AnswerSheetEntity> = {}): AnswerSheetEntity {
  return {
    id: SHEET_ID,
    userId: OWNER_ID,
    scaleVersionId: SCALE_VERSION_ID,
    scene: 'single',
    inviteId: null,
    answersJson: null,
    skippedDimensionsJson: null,
    draftVersion: 0,
    answeredCount: 0,
    durationSec: null,
    qualityFlag: null,
    dimensionScoresJson: null,
    status: 'draft',
    startedAt: FIXED_NOW,
    submittedAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

/** 报告模板夹具：正文区块 + 付费墙占位区块（LOCK_HINT 必须从正文中剥离） */
const TEMPLATE = {
  template: {
    id: 5,
    disclaimer:
      '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  },
  blocks: [
    { blockKey: 'INTRO', orderNo: 10, templateText: '以下是你各维度的取向。', minChars: null },
    {
      blockKey: 'LOCK_HINT',
      orderNo: 990,
      templateText: '邀请伴侣完成测评后可查看双方对比。',
      minChars: null,
    },
  ],
};

/** 已交卷答卷的计分缓存（INTIMACY 被跳过 → 未评估） */
function makeSubmittedCache(): SheetScoresCache {
  return {
    dimensions: [
      { code: 'FINANCE', name: '财务观与婚俗财务', evaluated: true, score: 50, supplemented: false },
      { code: 'INTIMACY', name: '亲密关系', evaluated: false, score: null, supplemented: false },
    ],
    baseline: { triggered: false, triggeredCodes: [], message: '' },
    quality: { isLowQuality: false, reasons: [], durationSec: 600 },
    styleAnswer: null,
    p16: null,
    skipped: ['INTIMACY'],
    supplemented: [],
    computedAt: FIXED_NOW.toISOString(),
  };
}

/**
 * 16 型量表夹具：4 个维度 × 每维 6 道二选一题（规则 8），二选一选项键为 A / B
 */
function makeP16Bundle(): ScaleBundle {
  const codes = ['ENERGY', 'INFO', 'DECISION', 'LIFESTYLE'];
  const names = ['能量来源', '信息偏好', '决策风格', '生活方式'];
  const dimensions = codes.map(
    (code, index) =>
      ({
        id: 100 + index,
        scaleVersionId: SCALE_VERSION_ID,
        code,
        name: names[index],
        orderNo: index + 1,
        isSensitive: 0,
        isScored: 1,
        createdAt: FIXED_NOW,
      }) as ScaleDimensionEntity,
  );

  const questions: ScaleQuestionEntity[] = [];
  let order = 1;
  codes.forEach((_, dimensionIndex) => {
    for (let index = 0; index < 6; index += 1) {
      questions.push({
        id: 200 + order,
        scaleVersionId: SCALE_VERSION_ID,
        dimensionId: 100 + dimensionIndex,
        code: `P${order}`,
        orderNo: order,
        type: 'binary',
        title: `16 型第 ${order} 题`,
        reverse: 0,
        isStyle: 0,
        isBaseline: 0,
        optionsJson: [
          { key: 'A', label: '更像 A 端' },
          { key: 'B', label: '更像 B 端' },
        ],
        extJson: null,
        status: 'on',
        createdAt: FIXED_NOW,
      });
      order += 1;
    }
  });

  // 生产事实：16 型不写 scoring_rule 行（seed-scale.ts 的 SCALE_CODES_NEED_SCORING_RULE 只含 SCALE-PRE），
  // 夹具必须与生产一致，否则「缺计分规则导致 16 型开不了卷」的缺陷会被夹具掩盖
  return {
    version: {
      id: SCALE_VERSION_ID,
      scaleId: 2,
      version: '1.0',
      status: 'frozen',
      itemCount: questions.length,
      introText: '凭直觉选，别犹豫，没有好坏之分。每题两个选项，选更像你的那个。',
      baselineIntroText: null,
      frozenAt: FIXED_NOW,
      createdBy: null,
      createdAt: FIXED_NOW,
    } as ScaleVersionEntity,
    scale: {
      id: 2,
      code: SCALE_CODE_16P,
      name: '16 型人格图谱',
      description: null,
      latestVersionId: SCALE_VERSION_ID,
      createdAt: FIXED_NOW,
    },
    dimensions,
    questions,
    scoringRule: null,
    engineDimensions: dimensions.map(toEngineDimension),
    engineQuestions: toEngineQuestions(questions, dimensions),
    engineRule: null,
  } as ScaleBundle;
}

/** 16 型报告模板夹具：含「类型名」占位符，无付费墙区块 */
const P16_TEMPLATE = {
  template: {
    id: 6,
    disclaimer:
      '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  },
  blocks: [
    {
      blockKey: 'INTRO',
      orderNo: 10,
      templateText: '你的 16 型人格图谱结果是：{类型名}。四个维度分别偏向如下。',
      minChars: null,
    },
  ],
};

/** 每个维度 4 个 A + 2 个 B → 四维均取 A 端（规则 8） */
function makeP16Answers(): Record<string, string> {
  const answers: Record<string, string> = {};
  for (let dimensionIndex = 0; dimensionIndex < 4; dimensionIndex += 1) {
    for (let index = 0; index < 6; index += 1) {
      const code = `P${dimensionIndex * 6 + index + 1}`;
      answers[code] = index < 4 ? 'A' : 'B';
    }
  }
  return answers;
}

describe('AssessmentService 单人测评流程（模块 4）', () => {
  const sheetRepository = {
    findOne: vi.fn(),
    create: vi.fn((input: Partial<AnswerSheetEntity>) => input),
    save: vi.fn(),
    update: vi.fn(),
  };
  const scaleQuery = {
    findActiveVersionByScaleCode: vi.fn(),
    loadBundle: vi.fn(),
  };
  const reportTemplate = { loadActiveTemplate: vi.fn() };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  let service: AssessmentService;
  let bundle: ScaleBundle;

  beforeEach(() => {
    vi.resetAllMocks();
    bundle = makeBundle();
    sheetRepository.create.mockImplementation((input: Partial<AnswerSheetEntity>) => input);
    sheetRepository.update.mockResolvedValue(undefined);
    scaleQuery.loadBundle.mockResolvedValue(bundle);
    reportTemplate.loadActiveTemplate.mockResolvedValue(TEMPLATE);
    service = new AssessmentService(
      sheetRepository as never,
      scaleQuery as unknown as ScaleQueryService,
      reportTemplate as unknown as ReportTemplateService,
      logger as unknown as AppLogger,
    );
  });

  /** 断言业务异常的错误码（避免只断言 message 造成脆弱测试） */
  async function expectBusinessError(
    promise: Promise<unknown>,
    code: ErrorCode,
  ): Promise<void> {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getResponse()).toMatchObject({ code });
  }

  describe('start：断点续答（B1）与重测（B6）', () => {
    it('无进行中的草稿时按生效版本新建答题卷', async () => {
      sheetRepository.findOne.mockResolvedValue(null);
      scaleQuery.findActiveVersionByScaleCode.mockResolvedValue(bundle.version);
      sheetRepository.save.mockResolvedValue(makeSheet({ id: 11 }));

      const result = await service.start(OWNER_ID, 'single');

      expect(scaleQuery.findActiveVersionByScaleCode).toHaveBeenCalledWith(SCALE_CODE_PRE);
      expect(sheetRepository.save).toHaveBeenCalledTimes(1);
      expect(sheetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER_ID, scaleVersionId: SCALE_VERSION_ID, scene: 'single' }),
      );
      expect(result.sheet.id).toBe(11);
      expect(result.sheet.status).toBe('draft');
      // 一次拉齐题目，减少小程序往返
      expect(result.paper.questions.map((item) => item.code)).toEqual([
        'Q1',
        'Q2',
        'Q3',
        'Q4',
        'Q5',
      ]);
      expect(result.paper.introText).toBe(bundle.version.introText);
    });

    it('已有进行中的草稿时续答，不新建答卷（B1）', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({ id: 22, answersJson: { Q1: 3 }, draftVersion: 2 }),
      );

      const result = await service.start(OWNER_ID, 'single');

      expect(sheetRepository.save).not.toHaveBeenCalled();
      expect(result.sheet.id).toBe(22);
      expect(result.sheet.draftVersion).toBe(2);
      expect(result.sheet.answeredCount).toBe(1);
      expect(result.sheet.totalCount).toBe(5);
    });

    it('量表没有生效版本时拒绝开始（不产生半成品答卷）', async () => {
      sheetRepository.findOne.mockResolvedValue(null);
      scaleQuery.findActiveVersionByScaleCode.mockResolvedValue(null);

      await expectBusinessError(service.start(OWNER_ID, 'single'), ErrorCode.SCALE_NOT_FOUND);
      expect(sheetRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent：入口续答摘要（B1）', () => {
    it('无进行中的草稿时返回 null', async () => {
      sheetRepository.findOne.mockResolvedValue(null);

      await expect(service.getCurrent(OWNER_ID, 'single')).resolves.toBeNull();
    });

    it('有草稿时返回服务端重算的进度（不采信客户端上报）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ id: 33, answersJson: { Q1: 1, Q2: 2 } }));

      const result = await service.getCurrent(OWNER_ID, 'single');

      expect(result).toEqual({
        id: 33,
        scene: 'single',
        answeredCount: 2,
        totalCount: 5,
        progressPercent: 40,
        startedAt: FIXED_NOW.toISOString(),
      });
    });
  });

  describe('越权与不存在的答题卷（隐私约束 2.4）', () => {
    it('答题卷不存在时返回资源不存在', async () => {
      sheetRepository.findOne.mockResolvedValue(null);

      await expectBusinessError(service.getDetail(OWNER_ID, SHEET_ID), ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('访问他人答题卷一律拒绝，且不透露「这份卷属于别人」', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ userId: OWNER_ID + 1 }));

      await expectBusinessError(service.getDetail(OWNER_ID, SHEET_ID), ErrorCode.FORBIDDEN);
    });
  });

  describe('saveDraft：增量合并 + 乐观锁 + 净化（B1/B2/A3）', () => {
    it('本次未出现的题号保留原答案（弱网分批补传）', async () => {
      const sheet = makeSheet({ answersJson: { Q1: 1 }, draftVersion: 0 });
      sheetRepository.findOne.mockResolvedValue(sheet);

      const result = await service.saveDraft(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q2: 3 },
      });

      expect(sheetRepository.update).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          answersJson: { Q1: 1, Q2: 3 },
          draftVersion: 1,
          answeredCount: 2,
        }),
      );
      expect(result.draftVersion).toBe(1);
      expect(result.answeredCount).toBe(2);
    });

    it('草稿版本不一致时拒绝写入（A3 多端覆盖保护）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ draftVersion: 4 }));

      await expectBusinessError(
        service.saveDraft(OWNER_ID, SHEET_ID, { draftVersion: 3, answers: { Q1: 1 } }),
        ErrorCode.ANSWER_DRAFT_CONFLICT,
      );
      expect(sheetRepository.update).not.toHaveBeenCalled();
    });

    it('未知题号与非法取值一律丢弃，不污染进度（净化）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      const result = await service.saveDraft(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 9, Q3: 'abc', Q99: 3, Q2: 4 },
      });

      expect(result.answers).toEqual({ Q2: 4 });
      expect(result.answeredCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('只允许跳过敏感维度：跳过普通维度直接拒绝（fail-closed）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      await expectBusinessError(
        service.saveDraft(OWNER_ID, SHEET_ID, { draftVersion: 0, skippedDimensions: ['FINANCE'] }),
        ErrorCode.PARAM_INVALID,
      );
      expect(sheetRepository.update).not.toHaveBeenCalled();
    });

    it('跳过敏感维度后，该维度答案被剔除且进度分母同步扣除（B7）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      const result = await service.saveDraft(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 5, Q3: 2, Q4: 2 },
        skippedDimensions: ['INTIMACY'],
      });

      // 声明跳过又偷偷作答的答案必须丢弃，避免报告口径矛盾
      expect(result.answers).toEqual({ Q1: 5 });
      expect(result.skippedDimensions).toEqual(['INTIMACY']);
      expect(result.answeredCount).toBe(1);
      expect(result.totalCount).toBe(3);
    });

    it('已交卷的答题卷不可再存草稿（B5 答案锁定）', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({ status: 'submitted', dimensionScoresJson: makeSubmittedCache() }),
      );

      await expectBusinessError(
        service.saveDraft(OWNER_ID, SHEET_ID, { draftVersion: 0, answers: { Q1: 1 } }),
        ErrorCode.ANSWER_LOCKED,
      );
    });
  });

  describe('submit：完整性校验 + 计分落库 + 简版报告', () => {
    it('尚有题目未作答时拒绝交卷', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ answersJson: { Q1: 5 } }));

      await expectBusinessError(
        service.submit(OWNER_ID, SHEET_ID, { draftVersion: 0, durationSec: 600 }),
        ErrorCode.ANSWER_INCOMPLETE,
      );
      expect(sheetRepository.update).not.toHaveBeenCalled();
    });

    it('答完交卷：落库维度分缓存并返回简版报告，LOCK_HINT 从正文剥离', async () => {
      const sheet = makeSheet();
      sheetRepository.findOne.mockResolvedValue(sheet);

      const report = await service.submit(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 5, Q2: 5, Q3: 5, Q4: 4, Q5: 5 },
        durationSec: 600,
      });

      // 规则 1 反向：Q2 = 6 - 5 = 1 → FINANCE 均分 (5 + 1) / 2 = 3 → (3 - 1) × 25 = 50
      // INTIMACY 均分 (5 + 4) / 2 = 4.5 → (4.5 - 1) × 25 = 87.5
      expect(report.dimensions).toEqual([
        expect.objectContaining({ code: 'FINANCE', evaluated: true, score: 50 }),
        expect.objectContaining({ code: 'INTIMACY', evaluated: true, score: 87.5 }),
      ]);
      expect(report.blocks.map((block) => block.blockKey)).toEqual(['INTRO']);
      expect(report.lockedHint).toBe(TEMPLATE.blocks[1].templateText);
      expect(report.disclaimer).toBe(TEMPLATE.template.disclaimer);
      expect(report.baselineNotice).toBeNull();
      expect(report.lowQualityNotice).toBeNull();

      expect(sheetRepository.update).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          status: 'submitted',
          qualityFlag: null,
          answeredCount: 5,
          durationSec: 600,
        }),
      );
      // 交卷时间必须落库（报告展示与历史快照都依赖它）
      expect(sheet.submittedAt).toBeInstanceOf(Date);
      expect(report.submittedAt).toBe(sheet.submittedAt?.toISOString());
    });

    it('未评估维度绝不写 0 分（拒绝授权 ≠ 极端取向）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      const report = await service.submit(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 5, Q2: 4, Q5: 5 },
        skippedDimensions: ['INTIMACY'],
        durationSec: 600,
      });

      const intimacy = report.dimensions.find((item) => item.code === 'INTIMACY');
      expect(intimacy).toEqual({
        code: 'INTIMACY',
        name: '亲密关系',
        evaluated: false,
        score: null,
        supplemented: false,
      });
      expect(report.lockedHint).toBe(TEMPLATE.blocks[1].templateText);
    });

    it('作答过快时返回低质量提示（规则 7 / B3）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      const report = await service.submit(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 5, Q2: 5, Q3: 3, Q4: 2, Q5: 4 },
        durationSec: 10,
      });

      expect(report.quality.isLowQuality).toBe(true);
      expect(report.lowQualityNotice).toBe(LOW_QUALITY_NOTICE_MESSAGE);
      expect(sheetRepository.update).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ qualityFlag: 'low' }),
      );
    });

    it('底线题作答 1-2 分时返回中性核实提示（规则 6 / P7）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      const report = await service.submit(OWNER_ID, SHEET_ID, {
        draftVersion: 0,
        answers: { Q1: 5, Q2: 5, Q3: 3, Q4: 2, Q5: 1 },
        durationSec: 600,
      });

      expect(report.baselineNotice).not.toBeNull();
    });

    it('报告模板缺失时 fail-closed（缺页脚免责声明属合规问题）', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());
      reportTemplate.loadActiveTemplate.mockResolvedValue(null);

      await expectBusinessError(
        service.submit(OWNER_ID, SHEET_ID, {
          draftVersion: 0,
          answers: { Q1: 5, Q2: 5, Q3: 5, Q4: 5, Q5: 5 },
          durationSec: 600,
        }),
        ErrorCode.REPORT_NOT_READY,
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReport：未交卷不可见（避免半份报告）', () => {
    it('草稿状态下拒绝查看报告', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet());

      await expectBusinessError(service.getReport(OWNER_ID, SHEET_ID), ErrorCode.REPORT_NOT_READY);
    });

    it('历史答卷按其锁定版本重新装载题目与模板（D5/B8 快照锚点）', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({ status: 'submitted', dimensionScoresJson: makeSubmittedCache(), submittedAt: FIXED_NOW }),
      );

      const report = await service.getReport(OWNER_ID, SHEET_ID);

      expect(scaleQuery.loadBundle).toHaveBeenCalledWith(SCALE_VERSION_ID, { includeOffline: true });
      expect(reportTemplate.loadActiveTemplate).toHaveBeenCalledWith({
        audience: 'single',
        scaleVersionId: SCALE_VERSION_ID,
      });
      expect(report.dimensions).toEqual(makeSubmittedCache().dimensions);
    });
  });

  describe('supplement：补答被跳过的敏感维度（B7 / A-4 / B5 唯一例外）', () => {
    it('没有待补答维度时拒绝', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({
          status: 'submitted',
          dimensionScoresJson: { ...makeSubmittedCache(), skipped: [] },
        }),
      );

      await expectBusinessError(
        service.supplement(OWNER_ID, SHEET_ID, { answers: { Q3: 4, Q4: 4 } }),
        ErrorCode.PARAM_INVALID,
      );
    });

    it('补答未一次补齐该维度全部题目时拒绝', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({ status: 'submitted', dimensionScoresJson: makeSubmittedCache() }),
      );

      await expectBusinessError(
        service.supplement(OWNER_ID, SHEET_ID, { answers: { Q3: 4 } }),
        ErrorCode.ANSWER_INCOMPLETE,
      );
      expect(sheetRepository.update).not.toHaveBeenCalled();
    });

    it('已交卷题目锁定：补答中夹带的已答题目被丢弃，原答案不被覆盖', async () => {
      sheetRepository.findOne.mockResolvedValue(
        makeSheet({
          status: 'submitted',
          answersJson: { Q1: 5, Q2: 5, Q5: 5 },
          dimensionScoresJson: makeSubmittedCache(),
        }),
      );

      const report = await service.supplement(OWNER_ID, SHEET_ID, {
        answers: { Q1: 1, Q3: 4, Q4: 4 },
      });

      expect(sheetRepository.update).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          answersJson: { Q1: 5, Q2: 5, Q5: 5, Q3: 4, Q4: 4 },
          skippedDimensionsJson: [],
        }),
      );
      // 补答后该维度转为已评估，并标记「补测」
      expect(report.dimensions.find((item) => item.code === 'INTIMACY')).toEqual(
        expect.objectContaining({ evaluated: true, supplemented: true, score: 75 }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('16 型人格图谱（规则 8 / 场景 p16）', () => {
    let p16Bundle: ScaleBundle;

    beforeEach(() => {
      p16Bundle = makeP16Bundle();
      scaleQuery.loadBundle.mockResolvedValue(p16Bundle);
      scaleQuery.findActiveVersionByScaleCode.mockResolvedValue(p16Bundle.version);
      reportTemplate.loadActiveTemplate.mockResolvedValue(P16_TEMPLATE);
    });

    it('scene=p16 时按 16 型量表（SCALE-16P）取生效版本', async () => {
      sheetRepository.findOne.mockResolvedValue(null);
      sheetRepository.save.mockResolvedValue(makeSheet({ id: 44, scene: 'p16' }));

      const result = await service.start(OWNER_ID, 'p16');

      expect(scaleQuery.findActiveVersionByScaleCode).toHaveBeenCalledWith(SCALE_CODE_16P);
      expect(sheetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ scene: 'p16' }),
      );
      // 24 道二选一题一次拉齐，单选题下发 A / B 两个选项
      expect(result.paper.questions).toHaveLength(24);
      expect(result.paper.questions[0].type).toBe('binary');
      expect(result.paper.questions[0].options?.map((item) => item.key)).toEqual(['A', 'B']);
      expect(result.paper.introText).toBe(p16Bundle.version.introText);
    });

    it('四维均取 A 端时命名为「领航者」，并下发维度名与渲染后的正文', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ id: 55, scene: 'p16' }));

      const report = await service.submit(OWNER_ID, 55, {
        draftVersion: 0,
        answers: makeP16Answers(),
        durationSec: 300,
      });

      expect(report.p16?.typeKey).toBe('A|A|A|A');
      expect(report.p16?.typeName).toBe('领航者');
      // 引擎只回维度编码，服务层须补齐维度名供报告展示（UI 不出现官方代号）
      expect(report.p16?.dimensions.map((item) => item.dimensionName)).toEqual([
        '能量来源',
        '信息偏好',
        '决策风格',
        '生活方式',
      ]);
      expect(report.p16?.dimensions.every((item) => item.pole === 'A' && item.aCount === 4)).toBe(
        true,
      );
      // {类型名} 占位符必须已被渲染替换，不能原样透传到端上
      expect(report.blocks[0].text).toContain('领航者');
      expect(report.blocks[0].missingKeys).toEqual([]);
      // 16 型无 8 维雷达图与底线题组，避免前端误画空图
      expect(report.dimensions).toEqual([]);
      expect(report.baselineNotice).toBeNull();
      // 16 型为快速画像，不作低质量判定（规格只对婚前评估设 B3/B4）
      expect(report.lowQualityNotice).toBeNull();
      expect(report.scaleName).toBe('16 型人格图谱');
    });

    it('A 端 3 票的平局维度按裁决 A-7 判 B 端并记录平局标记', async () => {
      sheetRepository.findOne.mockResolvedValue(makeSheet({ id: 66, scene: 'p16' }));
      const answers = makeP16Answers();
      // 第一维度（P1-P6）改为 3A + 3B → 触发平局分支
      answers.P1 = 'A';
      answers.P2 = 'A';
      answers.P3 = 'A';
      answers.P4 = 'B';
      answers.P5 = 'B';
      answers.P6 = 'B';

      const report = await service.submit(OWNER_ID, 66, {
        draftVersion: 0,
        answers,
        durationSec: 300,
      });

      expect(report.p16?.typeKey).toBe('B|A|A|A');
      expect(report.p16?.typeName).toBe('远谋者');
      expect(report.p16?.dimensions[0]).toMatchObject({ pole: 'B', aCount: 3, isTie: true });
    });
  });
});
