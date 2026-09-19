/**
 * 双人差值比对引擎单元测试
 * 规格依据：docs/constitution.md 第三部分「计分与判定规则」规则 3 / 4 / 5 / 6（L498-L501）
 * 说明：fixture 为本文件内自建的最小数据集，不依赖题库种子数据。
 */
import { BASELINE_NOTICE_MESSAGE } from './scale.constants.js';
import { compareDouble } from './diff.engine.js';
import type {
  AnswerMap,
  BaselineResult,
  DimensionScore,
  QualityFlag,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
  SingleScoringResult,
} from './scale.types.js';

const RULE: ScoringRuleConfig = {
  aggregateMethod: 'mean_normalized',
  diffThresholdHigh: 15,
  diffThresholdMid: 30,
  labels: { high: '高共识', mid: '待沟通', low: '重点待沟通' },
  qualityMinSec: 180,
};

const NO_BASELINE: BaselineResult = { triggered: false, triggeredCodes: [], message: '' };

const buildDimension = (
  code: string,
  orderNo: number,
  isScored = true,
): ScaleDimension => ({
  code,
  name: `${code}-维度`,
  orderNo,
  isSensitive: false,
  isScored,
});

const buildQuestion = (
  input: Partial<ScaleQuestion> & { code: string },
): ScaleQuestion => ({
  orderNo: 0,
  dimensionCode: null,
  type: 'scale',
  title: input.code,
  reverse: false,
  isStyle: false,
  isBaseline: false,
  options: null,
  ...input,
});

const buildQuality = (): QualityFlag => ({
  isLowQuality: false,
  reasons: [],
  durationSec: 300,
});

const buildResult = (input: {
  dimensions: DimensionScore[];
  baseline?: BaselineResult;
  quality?: QualityFlag;
}): SingleScoringResult => ({
  dimensions: input.dimensions,
  quality: input.quality ?? buildQuality(),
  baseline: input.baseline ?? NO_BASELINE,
  styleAnswer: null,
});

const buildScore = (code: string, score: number): DimensionScore => ({
  dimensionCode: code,
  dimensionName: `${code}-维度`,
  score,
  scoredCount: 6,
  answeredCount: 6,
});

const runCompare = (input: {
  questions?: ScaleQuestion[];
  dimensions: ScaleDimension[];
  resultA: SingleScoringResult;
  resultB: SingleScoringResult;
  answersA?: AnswerMap;
  answersB?: AnswerMap;
  rule?: ScoringRuleConfig;
}) =>
  compareDouble({
    questions: input.questions ?? [],
    dimensions: input.dimensions,
    resultA: input.resultA,
    resultB: input.resultB,
    answersA: input.answersA ?? {},
    answersB: input.answersB ?? {},
    rule: input.rule ?? RULE,
  });

describe('规则 5：差值分级（D6 恰在阈值归入较低一级）', () => {
  const cases = [
    { gap: 0, expected: 'high', label: '高共识', note: '完全一致' },
    { gap: 14, expected: 'high', label: '高共识', note: '尚未达下限阈值' },
    { gap: 15, expected: 'mid', label: '待沟通', note: 'D6：恰在下限阈值 → 归入较低一级 mid' },
    { gap: 30, expected: 'mid', label: '待沟通', note: 'D6：恰在上限阈值（闭区间）→ 仍为 mid' },
    { gap: 31, expected: 'low', label: '重点待沟通', note: '超过上限阈值' },
  ];

  for (const testCase of cases) {
    it(`gap=${testCase.gap} → ${testCase.expected}（${testCase.note}）`, () => {
      const result = runCompare({
        dimensions: [buildDimension('FINANCE', 1)],
        resultA: buildResult({ dimensions: [buildScore('FINANCE', 50)] }),
        resultB: buildResult({ dimensions: [buildScore('FINANCE', 50 - testCase.gap)] }),
      });

      expect(result.dimensions).toHaveLength(1);
      expect(result.dimensions[0].gap).toBe(testCase.gap);
      expect(result.dimensions[0].level).toBe(testCase.expected);
      expect(result.dimensions[0].levelLabel).toBe(testCase.label);
    });
  }

  it('浮点误差不越界：65.1 - 50.1 仍按 15 判为 mid', () => {
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 65.1)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 50.1)] }),
    });

    expect(result.dimensions[0].gap).toBe(15);
    expect(result.dimensions[0].level).toBe('mid');
  });

  it('阈值可后台配置：自定义阈值后分级随之变化', () => {
    const rule: ScoringRuleConfig = {
      ...RULE,
      diffThresholdHigh: 10,
      diffThresholdMid: 20,
      labels: { high: '一致', mid: '有差异', low: '差异明显' },
    };
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 50)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 40)] }),
      rule,
    });

    expect(result.dimensions[0].gap).toBe(10);
    expect(result.dimensions[0].level).toBe('mid');
    expect(result.dimensions[0].levelLabel).toBe('有差异');
  });
});

describe('规则 4：量表题逐题分歧', () => {
  it('|分差| ≥3 记为分歧，=2 不记（按原始答案值比较）', () => {
    const result = runCompare({
      questions: [
        buildQuestion({ code: 'Q1', orderNo: 1, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q2', orderNo: 2, dimensionCode: 'FINANCE' }),
      ],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 55)] }),
      answersA: { Q1: 5, Q2: 5 },
      answersB: { Q1: 3, Q2: 2 },
    });

    const divergences = result.dimensions[0].topDivergences;
    expect(divergences).toHaveLength(1);
    expect(divergences[0]).toMatchObject({
      questionCode: 'Q2',
      dimensionCode: 'FINANCE',
      kind: 'scale_gap',
      scoreA: 5,
      scoreB: 2,
      gap: 3,
      optionA: null,
      optionB: null,
    });
  });

  it('反向题同样按原始作答比较，不做 6-原值 翻转', () => {
    const result = runCompare({
      questions: [
        buildQuestion({
          code: 'Q5',
          orderNo: 5,
          dimensionCode: 'FINANCE',
          reverse: true,
        }),
      ],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 50)] }),
      // 记录的分值应为原始作答（5 / 1），而非反向后（1 / 5）
      answersA: { Q5: 5 },
      answersB: { Q5: 1 },
    });

    expect(result.dimensions[0].topDivergences[0]).toMatchObject({
      questionCode: 'Q5',
      scoreA: 5,
      scoreB: 1,
      gap: 4,
    });
  });

  it('每维度按分差降序取前 2，第 3 题被截断；同分差按题号升序（Q9 先于 Q10）', () => {
    const result = runCompare({
      questions: [
        // orderNo 刻意与题号顺序相反，以证明排序依据是题号而非卷内顺序
        buildQuestion({ code: 'Q9', orderNo: 3, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q10', orderNo: 2, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q11', orderNo: 1, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q12', orderNo: 4, dimensionCode: 'FINANCE' }),
      ],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 40)] }),
      answersA: { Q9: 5, Q10: 5, Q11: 5, Q12: 4 },
      answersB: { Q9: 2, Q10: 2, Q11: 1, Q12: 3 },
    });

    const codes = result.dimensions[0].topDivergences.map((item) => item.questionCode);
    expect(codes).toEqual(['Q11', 'Q9']);
    expect(codes).not.toContain('Q10');
    expect(result.dimensions[0].topDivergences[0].gap).toBe(4);
    expect(result.dimensions[0].topDivergences[1].gap).toBe(3);
  });

  it('另一方未作答或答案非法的题不进入分歧清单', () => {
    const result = runCompare({
      questions: [
        buildQuestion({ code: 'Q1', orderNo: 1, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q2', orderNo: 2, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q3', orderNo: 3, dimensionCode: 'FINANCE' }),
      ],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      answersA: { Q1: 5, Q2: 5, Q3: 5 },
      answersB: { Q1: 1, Q2: 0, Q3: 6 },
    });

    expect(result.dimensions[0].topDivergences.map((i) => i.questionCode)).toEqual(['Q1']);
  });
});

describe('规则 3：选择题分歧比对', () => {
  const choiceQuestions = [
    buildQuestion({ code: 'Q2', orderNo: 2, type: 'choice' }),
    buildQuestion({ code: 'Q3', orderNo: 3, type: 'choice' }),
    buildQuestion({ code: 'Q9', orderNo: 9, type: 'choice' }),
    buildQuestion({ code: 'Q37', orderNo: 37, type: 'choice' }),
    buildQuestion({ code: 'Q38', orderNo: 38, type: 'choice' }),
  ];

  it('选项不同记为分歧（gap=0），相同不记，任一方未作答不记，按题号升序', () => {
    const result = runCompare({
      questions: choiceQuestions,
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      // Q3 双方相同 → 不记；Q37 仅 A 作答、Q38 仅 B 作答 → 不记
      answersA: { Q2: '1', Q3: '2', Q9: '3', Q37: '4' },
      answersB: { Q2: '2', Q3: '2', Q9: '5', Q38: '1' },
    });

    expect(result.choiceDivergences.map((i) => i.questionCode)).toEqual(['Q2', 'Q9']);
    expect(result.choiceDivergences[0]).toMatchObject({
      questionCode: 'Q2',
      dimensionCode: null,
      kind: 'option_differ',
      scoreA: null,
      scoreB: null,
      optionA: '1',
      optionB: '2',
      gap: 0,
    });
  });

  it('选择题不参与维度分，也不进入维度逐题分歧', () => {
    const result = runCompare({
      questions: [buildQuestion({ code: 'Q3', orderNo: 3, type: 'choice' })],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      answersA: { Q3: '1' },
      answersB: { Q3: '5' },
    });

    expect(result.choiceDivergences).toHaveLength(1);
    expect(result.dimensions[0].topDivergences).toEqual([]);
  });
});

describe('规则 6 / 假设 A-5：底线提示', () => {
  it('任一方触发即整体触发，题号合并去重升序，文案取规格原文（双方同一文案）', () => {
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({
        dimensions: [buildScore('FINANCE', 60)],
        baseline: { triggered: true, triggeredCodes: ['Q74', 'Q72', 'Q72'], message: 'A 侧文案' },
      }),
      resultB: buildResult({
        dimensions: [buildScore('FINANCE', 58)],
        baseline: { triggered: false, triggeredCodes: ['Q72', 'Q76'], message: '' },
      }),
    });

    expect(result.baseline).toEqual({
      triggered: true,
      triggeredCodes: ['Q72', 'Q74', 'Q76'],
      message: BASELINE_NOTICE_MESSAGE,
    });
  });

  it('仅 B 方触发时同样整体触发', () => {
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({
        dimensions: [buildScore('FINANCE', 58)],
        baseline: { triggered: true, triggeredCodes: ['Q73'], message: BASELINE_NOTICE_MESSAGE },
      }),
    });

    expect(result.baseline.triggered).toBe(true);
    expect(result.baseline.triggeredCodes).toEqual(['Q73']);
    expect(result.baseline.message).toBe(BASELINE_NOTICE_MESSAGE);
  });

  it('双方均未触发时不提示、文案为空', () => {
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 58)] }),
    });

    expect(result.baseline).toEqual({ triggered: false, triggeredCodes: [], message: '' });
  });
});

describe('共识区 / 待沟通区划分与维度顺序', () => {
  it('consensus = high 维度，pending = mid + low，均保持维度顺序；非计分维度被排除', () => {
    const result = runCompare({
      dimensions: [
        buildDimension('FINANCE', 1),
        buildDimension('HOUSING', 2),
        buildDimension('COMMUNICATION', 3),
        buildDimension('CAREER', 4),
        buildDimension('BASELINE', 9, false),
      ],
      resultA: buildResult({
        dimensions: [
          buildScore('FINANCE', 50),
          buildScore('HOUSING', 60),
          buildScore('COMMUNICATION', 90),
          buildScore('CAREER', 40),
          buildScore('BASELINE', 0),
        ],
      }),
      resultB: buildResult({
        dimensions: [
          buildScore('FINANCE', 45),
          buildScore('HOUSING', 40),
          buildScore('COMMUNICATION', 50),
          buildScore('CAREER', 40),
          buildScore('BASELINE', 0),
        ],
      }),
    });

    expect(result.dimensions.map((i) => i.dimensionCode)).toEqual([
      'FINANCE',
      'HOUSING',
      'COMMUNICATION',
      'CAREER',
    ]);
    expect(result.consensusDimensions.map((i) => i.dimensionCode)).toEqual([
      'FINANCE',
      'CAREER',
    ]);
    expect(result.pendingDimensions.map((i) => i.dimensionCode)).toEqual([
      'HOUSING',
      'COMMUNICATION',
    ]);
    expect(result.dimensions.map((i) => i.level)).toEqual(['high', 'mid', 'low', 'high']);
  });

  it('维度顺序按 orderNo 升序，与入参顺序无关', () => {
    const result = runCompare({
      dimensions: [
        buildDimension('CAREER', 4),
        buildDimension('FINANCE', 1),
        buildDimension('HOUSING', 2),
      ],
      // 三维度双方都有分：本用例只验证排序，缺失分维度会被整维跳过（ADR-013 决策 4）
      resultA: buildResult({
        dimensions: [buildScore('CAREER', 50), buildScore('FINANCE', 50), buildScore('HOUSING', 50)],
      }),
      resultB: buildResult({
        dimensions: [buildScore('CAREER', 50), buildScore('FINANCE', 50), buildScore('HOUSING', 50)],
      }),
    });

    expect(result.dimensions.map((i) => i.dimensionCode)).toEqual([
      'FINANCE',
      'HOUSING',
      'CAREER',
    ]);
  });
});

describe('质量标记（C10）与健壮性', () => {
  it('quality 原样透传双方标记', () => {
    const qualityA: QualityFlag = { isLowQuality: true, reasons: ['too_fast'], durationSec: 60 };
    const qualityB: QualityFlag = { isLowQuality: true, reasons: ['all_same'], durationSec: 600 };
    const result = runCompare({
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({
        dimensions: [buildScore('FINANCE', 60)],
        quality: qualityA,
      }),
      resultB: buildResult({
        dimensions: [buildScore('FINANCE', 58)],
        quality: qualityB,
      }),
    });

    expect(result.quality).toEqual({ a: qualityA, b: qualityB });
  });

  it('答案缺失 / 类型不符 / 越界时不抛错，按未作答处理', () => {
    const result = runCompare({
      questions: [
        undefined as unknown as ScaleQuestion,
        buildQuestion({ code: 'Q1', orderNo: 1, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q2', orderNo: 2, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q3', orderNo: 3, dimensionCode: 'FINANCE' }),
        buildQuestion({ code: 'Q4', orderNo: 4, type: 'choice' }),
      ],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      resultB: buildResult({ dimensions: [buildScore('FINANCE', 60)] }),
      // Q1 字符串 '5'（类型不符）、Q2 = 0（越界）、Q3 = 6（越界）
      answersA: { Q1: '5', Q2: 0, Q3: 6 },
      answersB: { Q1: '5', Q2: 3, Q3: 2 },
    });

    expect(result.dimensions[0].topDivergences).toEqual([]);
    expect(result.choiceDivergences).toEqual([]);
    expect(result.dimensions[0].gap).toBe(0);
  });

  it('维度分缺失时不产出差异（不退化到 0 分兜底），其余结构仍完整', () => {
    const result = compareDouble({
      questions: undefined as unknown as ScaleQuestion[],
      dimensions: [buildDimension('FINANCE', 1)],
      resultA: buildResult({
        dimensions: [buildScore('FINANCE', 50)],
        baseline: undefined as unknown as BaselineResult,
        quality: undefined as unknown as QualityFlag,
      }),
      resultB: buildResult({ dimensions: [] }),
      answersA: undefined as unknown as AnswerMap,
      answersB: undefined as unknown as AnswerMap,
      rule: RULE,
    });

    // ADR-013 决策 4：B 方缺 FINANCE 分（未评估 / 零有效作答）时整维跳过。
    // 若沿用历史的 MISSING_SCORE = 0 兜底，会算出 gap=50 的假分歧，
    // 让用户看到双方根本没有分歧的「待沟通区」。真正的「未评估」清单由上层补齐。
    expect(result.dimensions).toEqual([]);
    expect(result.consensusDimensions).toEqual([]);
    expect(result.pendingDimensions).toEqual([]);
    expect(result.choiceDivergences).toEqual([]);
    expect(result.baseline).toEqual({ triggered: false, triggeredCodes: [], message: '' });
  });
});
