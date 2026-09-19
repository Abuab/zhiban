import { BASELINE_NOTICE_MESSAGE } from './scale.constants.js';
import { scorePreScale } from './scoring.engine.js';
import type {
  AnswerMap,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
} from './scale.types.js';

/** 最小计分规则配置（字段语义见 scale.types.ts） */
const makeRule = (over: Partial<ScoringRuleConfig> = {}): ScoringRuleConfig => ({
  aggregateMethod: 'mean_normalized',
  diffThresholdHigh: 15,
  diffThresholdMid: 30,
  labels: { high: '高共识', mid: '待沟通', low: '重点待沟通' },
  qualityMinSec: 180,
  ...over,
});

const makeDimension = (code: string, over: Partial<ScaleDimension> = {}): ScaleDimension => ({
  code,
  name: `${code}-维度`,
  orderNo: 1,
  isSensitive: false,
  isScored: true,
  ...over,
});

const makeScaleQuestion = (
  code: string,
  dimensionCode: string | null,
  over: Partial<ScaleQuestion> = {},
): ScaleQuestion => ({
  code,
  orderNo: 0,
  dimensionCode,
  type: 'scale',
  title: code,
  reverse: false,
  isStyle: false,
  isBaseline: false,
  options: null,
  ...over,
});

const score = (input: {
  questions: ScaleQuestion[];
  dimensions: ScaleDimension[];
  answers: AnswerMap;
  durationSec?: number;
  rule?: ScoringRuleConfig;
}) =>
  scorePreScale({
    questions: input.questions,
    dimensions: input.dimensions,
    answers: input.answers,
    durationSec: input.durationSec ?? 600,
    rule: input.rule ?? makeRule(),
  });

describe('scorePreScale · 规则 1 反向处理（constitution.md L496）', () => {
  it('反向题按 SCALE_VALUE_MAX + SCALE_VALUE_MIN - 原值 翻转', () => {
    const dimension = makeDimension('FINANCE');
    const forward = makeScaleQuestion('Q1', 'FINANCE');
    const reverse = makeScaleQuestion('Q2', 'FINANCE', { reverse: true });

    const result = score({
      questions: [forward, reverse],
      dimensions: [dimension],
      answers: { Q1: 1, Q2: 1 },
    });

    // Q1 → 1，Q2 → 6 - 1 = 5，均分 3 → (3 - 1) × 25 = 50
    expect(result.dimensions[0].score).toBe(50);
  });

  it('反向题作答应 5 翻转成最低分', () => {
    const dimension = makeDimension('FINANCE');
    const reverse = makeScaleQuestion('Q2', 'FINANCE', { reverse: true });

    const result = score({
      questions: [reverse],
      dimensions: [dimension],
      answers: { Q2: 5 },
    });

    expect(result.dimensions[0].score).toBe(0);
  });

  it('非反向题不作翻转', () => {
    const dimension = makeDimension('FINANCE');
    const forward = makeScaleQuestion('Q1', 'FINANCE');

    const result = score({
      questions: [forward],
      dimensions: [dimension],
      answers: { Q1: 5 },
    });

    expect(result.dimensions[0].score).toBe(100);
  });
});

describe('scorePreScale · 规则 2 维度分（constitution.md L497 / D-2）', () => {
  const buildDimensionWithAnswers = (values: number[]) => {
    const dimension = makeDimension('FINANCE');
    const questions = values.map((_, index) => makeScaleQuestion(`Q${index + 1}`, 'FINANCE'));
    const answers: AnswerMap = {};
    values.forEach((value, index) => {
      answers[`Q${index + 1}`] = value;
    });
    return score({ questions, dimensions: [dimension], answers });
  };

  it('全 1 分 → 0 分', () => {
    expect(buildDimensionWithAnswers([1, 1, 1]).dimensions[0].score).toBe(0);
  });

  it('全 5 分 → 100 分', () => {
    expect(buildDimensionWithAnswers([5, 5, 5]).dimensions[0].score).toBe(100);
  });

  it('均分 3 → 50 分（(均分 - 1) × 25，非均分 × 25）', () => {
    expect(buildDimensionWithAnswers([3, 3, 3]).dimensions[0].score).toBe(50);
  });

  it('分数保留 1 位小数（四舍五入）', () => {
    // 均分 4/3 → (4/3 - 1) × 25 = 8.333… → 8.3
    expect(buildDimensionWithAnswers([1, 1, 2]).dimensions[0].score).toBe(8.3);
  });

  it('只输出 isScored === true 的维度，且按 orderNo 升序', () => {
    const dimA = makeDimension('FINANCE', { orderNo: 2 });
    const dimB = makeDimension('HOUSING', { orderNo: 1 });
    const baseline = makeDimension('BASELINE', { orderNo: 9, isScored: false });
    const questions = [
      makeScaleQuestion('Q1', 'FINANCE'),
      makeScaleQuestion('Q2', 'HOUSING'),
    ];

    const result = score({
      questions,
      dimensions: [dimA, baseline, dimB],
      answers: { Q1: 3, Q2: 5 },
    });

    expect(result.dimensions.map((item) => item.dimensionCode)).toEqual(['HOUSING', 'FINANCE']);
  });

  it('维度均分只统计已作答的题（未作答不计入分母）', () => {
    const dimension = makeDimension('FINANCE');
    const questions = ['Q1', 'Q2', 'Q3'].map((code) => makeScaleQuestion(code, 'FINANCE'));

    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 3, Q2: 3 }, // Q3 未作答
    });

    expect(result.dimensions[0].score).toBe(50);
  });
});

describe('scorePreScale · 风格题（Q27，不计入维度分）', () => {
  const dimension = makeDimension('COMMUNICATION', { orderNo: 3 });
  const questions = [
    makeScaleQuestion('Q19', 'COMMUNICATION'),
    makeScaleQuestion('Q20', 'COMMUNICATION'),
    makeScaleQuestion('Q27', 'COMMUNICATION', { isStyle: true }),
  ];

  it('风格题不计入维度均分，但计入 scoredCount', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q19: 3, Q20: 3, Q27: 1 },
    });

    expect(result.dimensions[0].score).toBe(50);
    // 该维度参与计分的量表题 = Q19 / Q20（Q27 风格题排除）
    expect(result.dimensions[0].scoredCount).toBe(2);
    // 两题都作答 → answeredCount 与 scoredCount 相等（ADR-013 决策 3）
    expect(result.dimensions[0].answeredCount).toBe(2);
  });

  it('风格题已作答时返回 { code, value }', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q19: 3, Q20: 3, Q27: 4 },
    });

    expect(result.styleAnswer).toEqual({ code: 'Q27', value: 4 });
  });

  it('风格题未作答（或非法值）时返回 null', () => {
    expect(
      score({ questions, dimensions: [dimension], answers: { Q19: 3, Q20: 3 } }).styleAnswer,
    ).toBeNull();

    expect(
      score({ questions, dimensions: [dimension], answers: { Q27: 6 } }).styleAnswer,
    ).toBeNull();
  });
});

describe('scorePreScale · 规则 6 底线题（constitution.md L501 / L418-419）', () => {
  const baselineDimension = makeDimension('BASELINE', { orderNo: 9, isScored: false });
  const baselineQuestions = ['Q72', 'Q73', 'Q74', 'Q75', 'Q76'].map((code) =>
    makeScaleQuestion(code, null, { isBaseline: true }),
  );

  it('任一题作答 1-2 分即触发，并返回规格文案', () => {
    const result = score({
      questions: baselineQuestions,
      dimensions: [baselineDimension],
      answers: { Q73: 2, Q74: 5, Q75: 1 },
    });

    expect(result.baseline.triggered).toBe(true);
    expect(result.baseline.triggeredCodes).toEqual(['Q73', 'Q75']);
    expect(result.baseline.message).toBe(BASELINE_NOTICE_MESSAGE);
  });

  it('全部作答 3 分以上时不触发，message 为空串', () => {
    const result = score({
      questions: baselineQuestions,
      dimensions: [baselineDimension],
      answers: { Q72: 3, Q73: 3, Q74: 4, Q75: 5, Q76: 3 },
    });

    expect(result.baseline.triggered).toBe(false);
    expect(result.baseline.triggeredCodes).toEqual([]);
    expect(result.baseline.message).toBe('');
  });

  it('触发题号按题号升序（与作答顺序无关）', () => {
    const result = score({
      questions: baselineQuestions,
      dimensions: [baselineDimension],
      answers: { Q75: 2, Q72: 1 },
    });

    expect(result.baseline.triggeredCodes).toEqual(['Q72', 'Q75']);
  });

  it('越界值不触发，且底线题不参与任何维度分', () => {
    const result = score({
      questions: baselineQuestions,
      dimensions: [baselineDimension],
      answers: { Q72: 0, Q73: 6, Q74: 1 },
    });

    // 仅 Q74 = 1 命中；Q72 = 0 / Q73 = 6 视为非法答案
    expect(result.baseline.triggeredCodes).toEqual(['Q74']);
    // BASELINE 维度 isScored === false，不产出维度分
    expect(result.dimensions).toEqual([]);
  });
});

describe('scorePreScale · 规则 7 作答质量（constitution.md L502 / B3、B4）', () => {
  const dimension = makeDimension('FINANCE');
  const questions = ['Q1', 'Q2', 'Q3'].map((code) => makeScaleQuestion(code, 'FINANCE'));

  it('时长不足 → too_fast', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 1, Q2: 3, Q3: 5 },
      durationSec: 179,
    });

    expect(result.quality.isLowQuality).toBe(true);
    expect(result.quality.reasons).toEqual(['too_fast']);
    expect(result.quality.durationSec).toBe(179);
  });

  it('时长恰等于阈值 → 不命中 too_fast', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 1, Q2: 3, Q3: 5 },
      durationSec: 180,
    });

    expect(result.quality.isLowQuality).toBe(false);
    expect(result.quality.reasons).toEqual([]);
  });

  it('全部答案同值 → all_same', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 3, Q2: 3, Q3: 3 },
      durationSec: 600,
    });

    expect(result.quality.isLowQuality).toBe(true);
    expect(result.quality.reasons).toEqual(['all_same']);
  });

  it('数值 3 与字符串 "3" 视为同一值 → all_same', () => {
    const choice = makeScaleQuestion('Q3', 'FINANCE', {
      type: 'choice',
      options: [
        { key: '3', label: '形式，意思一下' },
        { key: '5', label: '我家没有彩礼习俗' },
      ],
    });

    const result = score({
      questions: [questions[0], questions[1], choice],
      dimensions: [dimension],
      answers: { Q1: 3, Q2: 3, Q3: '3' },
      durationSec: 600,
    });

    expect(result.quality.reasons).toEqual(['all_same']);
  });

  it('两项同时命中时按固定顺序输出', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 3, Q2: 3, Q3: 3 },
      durationSec: 10,
    });

    expect(result.quality.isLowQuality).toBe(true);
    expect(result.quality.reasons).toEqual(['too_fast', 'all_same']);
  });

  it('都不命中 → isLowQuality false', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 1, Q2: 3, Q3: 5 },
      durationSec: 600,
    });

    expect(result.quality.isLowQuality).toBe(false);
    expect(result.quality.reasons).toEqual([]);
  });

  it('完全未作答时不判 all_same', () => {
    const result = score({
      questions,
      dimensions: [dimension],
      answers: {},
      durationSec: 600,
    });

    expect(result.quality.reasons).toEqual([]);
  });
});

describe('scorePreScale · 健壮性（未作答 / 非法答案）', () => {
  it('越界值、非数值、非整数一律忽略且不抛错', () => {
    const dimension = makeDimension('FINANCE');
    const questions = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map((code) =>
      makeScaleQuestion(code, 'FINANCE'),
    );

    const result = score({
      questions,
      dimensions: [dimension],
      answers: {
        Q1: 3,
        Q2: 2,
        Q3: 0, // 越界下界
        Q4: 6, // 越界上界
        Q5: 'abc', // 非数值
        Q6: 2.5, // 非整数
        Q999: 3, // 题库中不存在的题号
      },
    });

    // 仅 Q1=3 与 Q2=2 有效：均分 2.5 → (2.5 - 1) × 25 = 37.5
    expect(result.dimensions[0].score).toBe(37.5);
    expect(result.dimensions[0].scoredCount).toBe(6);
    // 6 道题里只有 2 道有效作答（ADR-013 决策 3）
    expect(result.dimensions[0].answeredCount).toBe(2);
  });

  it('零有效作答 → score 为 null 且 answeredCount 为 0（绝不写 0 分）', () => {
    const dimension = makeDimension('FINANCE');
    const questions = ['Q1', 'Q2'].map((code) => makeScaleQuestion(code, 'FINANCE'));

    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: null as unknown as number },
    });

    // ADR-013 决策 3：0 分与「全选 1 分」的得分数值相同，
    // 一题未答必须判为 null（未评估），否则会被误读为「极端取向」。
    expect(result.dimensions[0].score).toBeNull();
    expect(result.dimensions[0].scoredCount).toBe(2);
    expect(result.dimensions[0].answeredCount).toBe(0);
    expect(result.quality.isLowQuality).toBe(false);
  });

  it('部分作答 → 均分只算已答题，answeredCount 小于 scoredCount', () => {
    const dimension = makeDimension('FINANCE');
    const questions = ['Q1', 'Q2', 'Q3', 'Q4'].map((code) => makeScaleQuestion(code, 'FINANCE'));

    const result = score({
      questions,
      dimensions: [dimension],
      answers: { Q1: 5, Q2: 3 },
    });

    // 均分 4 → (4 - 1) × 25 = 75；分母只有 2 题
    expect(result.dimensions[0].score).toBe(75);
    expect(result.dimensions[0].scoredCount).toBe(4);
    expect(result.dimensions[0].answeredCount).toBe(2);
  });

  it('空题库 / 空维度时返回结构完整的空结果', () => {
    const result = score({ questions: [], dimensions: [], answers: {} });

    expect(result.dimensions).toEqual([]);
    expect(result.baseline).toEqual({ triggered: false, triggeredCodes: [], message: '' });
    expect(result.styleAnswer).toBeNull();
    expect(result.quality).toEqual({ isLowQuality: false, reasons: [], durationSec: 600 });
  });
});
