/**
 * 双人对比报告数据构建引擎单元测试
 * 规格依据：ADR-005 决策 7（未评估维度不参与差值比对）/ ADR-013 决策 4
 *   （「未评估」有两种成因：维度级跳过 + 该方无该维度分，二者缺一不可）
 * 说明：fixture 为本文件内自建的最小数据集，不依赖题库种子数据。
 */
import {
  buildDoubleReportData,
  type DoubleParticipantSnapshot,
} from './double-report.engine.js';
import type {
  AnswerMap,
  BaselineResult,
  QualityFlag,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
} from '../scale/scale.types.js';

const RULE: ScoringRuleConfig = {
  aggregateMethod: 'mean_normalized',
  diffThresholdHigh: 15,
  diffThresholdMid: 30,
  labels: { high: '高共识', mid: '待沟通', low: '重点待沟通' },
  qualityMinSec: 180,
};

const NO_BASELINE: BaselineResult = { triggered: false, triggeredCodes: [], message: '' };

const buildQuality = (): QualityFlag => ({ isLowQuality: false, reasons: [], durationSec: 300 });

const buildDimension = (code: string, orderNo: number, isScored = true): ScaleDimension => ({
  code,
  name: `${code}-维度`,
  orderNo,
  isSensitive: false,
  isScored,
});

const buildQuestion = (input: Partial<ScaleQuestion> & { code: string }): ScaleQuestion => ({
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

/** 单方快照：`dimensionScores` 只含**已评估**维度（缺失即代表该维度零有效作答/未评估） */
const buildSnapshot = (input: {
  nickname?: string;
  answers?: AnswerMap;
  dimensionScores: Array<{ dimensionCode: string; score: number }>;
  skippedDimensions?: string[];
}): DoubleParticipantSnapshot => ({
  nickname: input.nickname ?? '一方',
  answers: input.answers ?? {},
  dimensionScores: input.dimensionScores,
  skippedDimensions: input.skippedDimensions ?? [],
  quality: buildQuality(),
  baseline: NO_BASELINE,
});

describe('ADR-013 决策 4：任一方未评估的维度不参与比对', () => {
  it('一方该维度零有效作答（快照无该维度分）→ 进 unevaluatedDimensions，且不出现在 dimensions / pendingDimensions', () => {
    const data = buildDoubleReportData({
      questions: [buildQuestion({ code: 'Q1', orderNo: 1, dimensionCode: 'FINANCE' })],
      dimensions: [buildDimension('FINANCE', 1), buildDimension('INTIMACY', 2)],
      initiator: buildSnapshot({
        answers: { Q1: 5 },
        dimensionScores: [
          { dimensionCode: 'FINANCE', score: 50 },
          // 发起方 INTIMACY 已评估
          { dimensionCode: 'INTIMACY', score: 80 },
        ],
      }),
      // 被邀请方 INTIMACY 题目被逐题跳完 → 生成期已按 `evaluated && typeof score === 'number'` 过滤，无该维度分
      invitee: buildSnapshot({
        answers: { Q1: 5 },
        dimensionScores: [{ dimensionCode: 'FINANCE', score: 50 }],
      }),
      rule: RULE,
    });

    // 只比双方都评估的维度
    expect(data.dimensions.map((row) => row.dimensionCode)).toEqual(['FINANCE']);
    expect(data.consensusDimensions.map((row) => row.dimensionCode)).toEqual(['FINANCE']);
    expect(data.pendingDimensions).toEqual([]);
    expect(data.unevaluatedDimensions).toEqual([
      { dimensionCode: 'INTIMACY', dimensionName: 'INTIMACY-维度' },
    ]);
  });

  it('缺失分不得退化为 0 分兜底：一方 INTIMACY=80、另一方未评估时不产出「分差 80」的假分歧', () => {
    const data = buildDoubleReportData({
      questions: [],
      dimensions: [buildDimension('FINANCE', 1), buildDimension('INTIMACY', 2)],
      initiator: buildSnapshot({
        dimensionScores: [
          { dimensionCode: 'FINANCE', score: 50 },
          { dimensionCode: 'INTIMACY', score: 80 },
        ],
      }),
      invitee: buildSnapshot({ dimensionScores: [{ dimensionCode: 'FINANCE', score: 50 }] }),
      rule: RULE,
    });

    // 若退化为 MISSING_SCORE = 0，会得到 gap = 80 的「重点待沟通」假分歧
    expect(data.pendingDimensions).toEqual([]);
    expect(data.dimensions.map((row) => row.dimensionCode)).toEqual(['FINANCE']);
    expect(data.unevaluatedDimensions.map((row) => row.dimensionCode)).toEqual(['INTIMACY']);
  });

  it('维度级跳过（skippedDimensions）同样进 unevaluatedDimensions；非计分底线题组不标注', () => {
    const data = buildDoubleReportData({
      questions: [],
      dimensions: [
        buildDimension('FINANCE', 1),
        buildDimension('INTIMACY', 2),
        // 底线题组不参与维度分，既不入比对也不应被标成「未评估」
        buildDimension('BASELINE', 3, false),
      ],
      initiator: buildSnapshot({
        dimensionScores: [{ dimensionCode: 'FINANCE', score: 50 }],
        skippedDimensions: ['INTIMACY'],
      }),
      invitee: buildSnapshot({ dimensionScores: [{ dimensionCode: 'FINANCE', score: 50 }] }),
      rule: RULE,
    });

    expect(data.unevaluatedDimensions.map((row) => row.dimensionCode)).toEqual(['INTIMACY']);
  });

  it('双方均已评估的维度正常参与比对（对照组）', () => {
    const data = buildDoubleReportData({
      questions: [],
      dimensions: [buildDimension('FINANCE', 1)],
      initiator: buildSnapshot({ dimensionScores: [{ dimensionCode: 'FINANCE', score: 50 }] }),
      invitee: buildSnapshot({ dimensionScores: [{ dimensionCode: 'FINANCE', score: 70 }] }),
      rule: RULE,
    });

    expect(data.unevaluatedDimensions).toEqual([]);
    expect(data.dimensions[0]).toMatchObject({
      dimensionCode: 'FINANCE',
      dimensionName: 'FINANCE-维度',
      scoreA: 50,
      scoreB: 70,
      gap: 20,
      level: 'mid',
    });
    expect(data.pendingDimensions.map((row) => row.dimensionCode)).toEqual(['FINANCE']);
    expect(data.consensusDimensions).toEqual([]);
  });
});
