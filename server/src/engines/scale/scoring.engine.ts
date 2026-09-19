/**
 * L1 领域引擎层 · 婚前评估（SCALE-PRE）单人计分引擎
 *
 * 实现规格《题库 v1.0 第三部分：计分与判定规则》中的第 1、2、6、7 条：
 * - 规则 1 反向处理（constitution.md L496）
 * - 规则 2 维度分（constitution.md L497）
 * - 规则 6 底线题触发（constitution.md L501、L418-419）
 * - 规则 7 作答质量（constitution.md L502）
 *
 * 硬约束（docs/architecture.md §2）：本文件只接受纯数据结构入参，
 * 禁止 import 任何 DB / HTTP / NestJS 模块，保证 8 条规则可 100% 单元测试。
 */
import {
  BASELINE_NOTICE_MESSAGE,
  NORMALIZE_FACTOR,
  SCALE_VALUE_MAX,
  SCALE_VALUE_MIN,
} from './scale.constants.js';
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

/** 分数保留 1 位小数：四舍五入到 0.1（规则 2 要求保留 1 位小数） */
const SCORE_PRECISION_FACTOR = 10;

/**
 * 底线题触发上界（规则 6 / L418）：作答「很不同意=1 / 不同意=2」即触发。
 * 用常量推导，避免字面量 2。
 */
const BASELINE_TRIGGER_MAX = SCALE_VALUE_MIN + 1;

/** 保留 1 位小数（四舍五入） */
function roundToOneDecimal(value: number): number {
  return Math.round(value * SCORE_PRECISION_FACTOR) / SCORE_PRECISION_FACTOR;
}

/**
 * 解析量表题原始分（规则 1：1-5）。
 * 健壮性：非数值、非整数、越界（0 / 6 / NaN / 'abc'）一律视为未作答，返回 null。
 */
function resolveScaleValue(raw: number | string | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < SCALE_VALUE_MIN || raw > SCALE_VALUE_MAX) return null;
  return raw;
}

/** 规则 1 反向翻转：reverse 题取 SCALE_VALUE_MAX + SCALE_VALUE_MIN - 原值（即 6 - 原值） */
function reverseScaleValue(value: number): number {
  return SCALE_VALUE_MAX + SCALE_VALUE_MIN - value;
}

/**
 * 把任意题型的原始答案归一为可比较的字符串键；非法答案返回 null（视为未作答）。
 * - 量表题（含风格题 / 底线题）：整数 1-5 → '1'..'5'
 * - 二选一题：'A' / 'B'
 * - 选择题：选项键（有 options 时须命中其中一项）
 * 用于规则 7「全部已作答题目答案值相同」的判定（统一转字符串后比较）。
 */
function resolveAnswerKey(
  question: ScaleQuestion,
  raw: number | string | undefined,
): string | null {
  if (raw === undefined || raw === null) return null;

  if (question.type === 'scale') {
    const value = resolveScaleValue(raw);
    return value === null ? null : String(value);
  }

  if (question.type === 'binary') {
    return raw === 'A' || raw === 'B' ? raw : null;
  }

  const key = String(raw);
  if (key === '') return null;
  if (question.options && !question.options.some((option) => option.key === key)) return null;
  return key;
}

/** 题号自然升序（'Q9' 排在 'Q10' 之前） */
function compareQuestionCodes(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** 该维度中参与计分的量表题 = 量表题 且 非风格题 且 非底线题（规则 2） */
function isScoringItem(question: ScaleQuestion, dimensionCode: string): boolean {
  return (
    question.type === 'scale' &&
    !question.isStyle &&
    !question.isBaseline &&
    question.dimensionCode === dimensionCode
  );
}

/** 规则 2：维度分 = (均分 - 1) × 25，归一化到 0-100（阶段 0 裁决 D-2，architecture.md L14） */
function buildDimensionScore(
  dimension: ScaleDimension,
  questions: ScaleQuestion[],
  answers: AnswerMap,
): DimensionScore {
  const scoringItems = questions.filter((question) => isScoringItem(question, dimension.code));

  const effectiveValues: number[] = [];
  for (const question of scoringItems) {
    const raw = resolveScaleValue(answers[question.code]);
    if (raw === null) continue; // 未作答 / 非法值：跳过，不计入均分分母
    effectiveValues.push(question.reverse ? reverseScaleValue(raw) : raw);
  }

  // 零有效作答 → score = null（ADR-013 决策 3）。绝不写 0：
  // 「一题未答」与「全选 1 分」的得分都是 0，写 0 会把「未评估」误读为「极端取向」。
  let score: number | null = null;
  if (effectiveValues.length > 0) {
    const total = effectiveValues.reduce((sum, value) => sum + value, 0);
    const mean = total / effectiveValues.length;
    // ⚠️ 题库原文写作「均分 × 25」，阶段 0 裁决 D-2（docs/architecture.md L14）
    //    修正为「(均分 - 1) × 25」，区间 0-100。此处按 D-2 实现。
    score = roundToOneDecimal((mean - SCALE_VALUE_MIN) * NORMALIZE_FACTOR);
  }

  return {
    dimensionCode: dimension.code,
    dimensionName: dimension.name,
    score,
    // scoredCount = 该维度参与计分的题数（不含风格题 / 底线题 / 选择题），
    // 与是否作答无关：未作答的题不计入均分分母，但仍计入 scoredCount。
    scoredCount: scoringItems.length,
    // answeredCount = 实际计入均分的题数（ADR-013 决策 3）：逐题跳过后与 scoredCount 出现差值的那个数。
    answeredCount: effectiveValues.length,
  };
}

/** 规则 6：底线题任一作答 1-2 分即触发，命中题号按题号升序 */
function buildBaselineResult(
  questions: ScaleQuestion[],
  answers: AnswerMap,
): BaselineResult {
  const triggeredCodes = questions
    .filter((question) => {
      if (!question.isBaseline) return false;
      const value = resolveScaleValue(answers[question.code]);
      return value !== null && value <= BASELINE_TRIGGER_MAX;
    })
    .map((question) => question.code)
    .sort(compareQuestionCodes);

  const triggered = triggeredCodes.length > 0;
  return {
    triggered,
    triggeredCodes,
    message: triggered ? BASELINE_NOTICE_MESSAGE : '',
  };
}

/** 规则 7：作答质量标记；reasons 固定按 ['too_fast','all_same'] 顺序输出 */
function buildQualityFlag(
  questions: ScaleQuestion[],
  answers: AnswerMap,
  durationSec: number,
  rule: ScoringRuleConfig,
): QualityFlag {
  const reasons: Array<'too_fast' | 'all_same'> = [];

  if (durationSec < rule.qualityMinSec) reasons.push('too_fast');

  const answerKeys = new Set<string>();
  for (const question of questions) {
    const key = resolveAnswerKey(question, answers[question.code]);
    if (key !== null) answerKeys.add(key);
  }
  if (answerKeys.size === 1) reasons.push('all_same');

  return { isLowQuality: reasons.length > 0, reasons, durationSec };
}

/** 风格题作答（Q27）：已作答返回原始分值，未作答返回 null */
function buildStyleAnswer(
  questions: ScaleQuestion[],
  answers: AnswerMap,
): { code: string; value: number } | null {
  const styleQuestion = questions
    .filter((question) => question.isStyle)
    .sort((a, b) => a.orderNo - b.orderNo)[0];
  if (!styleQuestion) return null;

  const value = resolveScaleValue(answers[styleQuestion.code]);
  return value === null ? null : { code: styleQuestion.code, value };
}

/**
 * 婚前评估单人计分（规则 1、2、6、7）。
 *
 * @param input.questions  题库快照（纯数据）
 * @param input.dimensions 维度定义（纯数据）
 * @param input.answers    题号 → 原始答案
 * @param input.durationSec 作答总时长（秒）
 * @param input.rule       计分规则配置（由调用方从 scoring_rule 读出后传入）
 */
export function scorePreScale(input: {
  questions: ScaleQuestion[];
  dimensions: ScaleDimension[];
  answers: AnswerMap;
  durationSec: number;
  rule: ScoringRuleConfig;
}): SingleScoringResult {
  const { questions, dimensions, answers, durationSec, rule } = input;

  const scoredDimensions = dimensions
    .filter((dimension) => dimension.isScored)
    .sort((a, b) => a.orderNo - b.orderNo);

  return {
    dimensions: scoredDimensions.map((dimension) =>
      buildDimensionScore(dimension, questions, answers),
    ),
    quality: buildQualityFlag(questions, answers, durationSec, rule),
    baseline: buildBaselineResult(questions, answers),
    styleAnswer: buildStyleAnswer(questions, answers),
  };
}
