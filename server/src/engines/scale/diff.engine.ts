/**
 * L1 领域引擎层 · 双人差值比对引擎
 *
 * 实现《docs/constitution.md》第三部分「计分与判定规则」的规则 3 / 4 / 5，
 * 以及规则 6（底线提示，双方合并）与 C10（质量标记透传）：
 * - 规则 3（L498）：选择题（Q3/Q37/Q38）不参与维度分，作为分歧比对题，两人选项不同即分歧。
 * - 规则 4（L499）：量表题同题 |分差| ≥ 3（SCALE_GAP_THRESHOLD）记为分歧题；
 *                  每维度按分差降序取前 2 题（TOP_DIVERGENCE_LIMIT）进入报告。
 * - 规则 5（L500）：<15 高共识 / 15-30 待沟通 / >30 重点待沟通（阈值后台可配）。
 * - 规则 6（L501）：底线组任一题答 1-2 分即触发核实提示；假设 A-5（architecture.md L356）
 *                  双方同一文案、不含关系判词 → 合并双方命中题号，取规格原文文案。
 * - ADR-013 决策 4：任一方缺某维度分（未评估 / 零有效作答）时该维度**整维跳过**，
 *                  绝不用 0 分兜底 —— 否则会凭空算出「分差 = 另一方的分」的假分歧。
 *
 * 纯函数：入参全为纯数据结构，禁止依赖 DB / HTTP / NestJS（architecture.md §2 依赖规则）。
 */
import {
  BASELINE_NOTICE_MESSAGE,
  SCALE_GAP_THRESHOLD,
  SCALE_VALUE_MAX,
  SCALE_VALUE_MIN,
  TOP_DIVERGENCE_LIMIT,
} from './scale.constants.js';
import type {
  AnswerMap,
  BaselineResult,
  DimensionComparison,
  DimensionScore,
  DoubleComparisonResult,
  QuestionDivergence,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
  SingleScoringResult,
} from './scale.types.js';

/** 差值分级取值 */
type GapLevel = DimensionComparison['level'];

/** 规则 3：选项不同即分歧，无分差概念 → 选择题分歧的 gap 固定为 0 */
const CHOICE_DIVERGENCE_GAP = 0;

/**
 * 分值小数位（D-2：维度分保留 1 位小数）。分差同样按此口径取整，
 * 避免浮点误差把「恰好 15」算成 15.000000000000007 而误判为 low（D6 边界敏感）。
 */
const SCORE_DECIMALS = 1;
const SCORE_FACTOR = 10 ** SCORE_DECIMALS;

/** 卷内顺序缺失时的兜底排序值 */
const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;

/** 宽松数值解析：接受 number 与数字字符串（MySQL DECIMAL 常以字符串返回），其余返回 NaN */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** 取题号中的数字部分（'Q12' → 12），无数字返回 NaN */
function codeNumber(code: string): number {
  const matched = /(\d+)\s*$/.exec(code);
  return matched ? Number(matched[1]) : Number.NaN;
}

/** 题号升序（数字部分优先，保证 Q9 < Q10 < Q37）；数字部分相同则退化为字符串比较 */
function compareQuestionCodes(a: string, b: string): number {
  const na = codeNumber(a);
  const nb = codeNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 读取量表题答案：仅接受 [1, 5] 内的有限数值，其余（缺失 / 类型不符 / 越界）一律按未作答 */
function readScaleAnswer(answers: AnswerMap | undefined, code: string): number | null {
  const raw = answers?.[code];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < SCALE_VALUE_MIN || raw > SCALE_VALUE_MAX) return null;
  return raw;
}

/** 读取选择/二选一题答案：非空字符串或有限数值（统一转字符串比较），其余按未作答 */
function readChoiceAnswer(answers: AnswerMap | undefined, code: string): string | null {
  const raw = answers?.[code];
  if (typeof raw === 'string') return raw === '' ? null : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/** 单人维度分索引：仅收录编码合法且分值为有限数值的记录 */
function toScoreMap(result: SingleScoringResult | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  const rows: DimensionScore[] = Array.isArray(result?.dimensions) ? result.dimensions : [];
  for (const row of rows) {
    if (!row || typeof row.dimensionCode !== 'string' || row.dimensionCode === '') continue;
    if (typeof row.score !== 'number' || !Number.isFinite(row.score)) continue;
    map.set(row.dimensionCode, row.score);
  }
  return map;
}

/** 维度卷内顺序（非法值排到末尾，保证确定性） */
function orderNoOf(dimension: ScaleDimension): number {
  return typeof dimension.orderNo === 'number' && Number.isFinite(dimension.orderNo)
    ? dimension.orderNo
    : UNKNOWN_ORDER;
}

/**
 * 规则 5 差值分级（D6：恰在阈值归入较低一级）
 * - gap < diffThresholdHigh        → 'high'
 * - diffThresholdHigh ≤ gap ≤ mid  → 'mid'（**闭区间，两端都归 mid**）
 * - gap > diffThresholdMid         → 'low'
 * 阈值缺失/非法时不抛错，退化为 'mid'。
 */
function classifyGap(gap: number, rule: ScoringRuleConfig): GapLevel {
  const high = toNumber(rule?.diffThresholdHigh);
  const mid = toNumber(rule?.diffThresholdMid);
  if (gap < high) return 'high';
  if (gap <= mid) return 'mid';
  if (gap > mid) return 'low';
  return 'mid';
}

/** 分级文案取自 ScoringRuleConfig.labels（中性命名，P7） */
function resolveLevelLabel(rule: ScoringRuleConfig, level: GapLevel): string {
  const label = rule?.labels?.[level];
  return typeof label === 'string' ? label : '';
}

/**
 * 规则 4 逐题分歧：维度下所有量表题（含风格题 Q27，规格第 4 条未将其排除），
 * 双方均已作答且答案合法时才比较；|原始分差| ≥ 3 记为分歧。
 *
 * 注：此处用**原始答案值**比较，不做反向题翻转。依据规格第 4 条原文
 * 「量表题同题 |分差| ≥3」——反向处理属于规则 1 的计分口径，只作用于维度分，
 * 而分歧比对衡量的是「两人对同一句话的同意度差异」，故按原始作答比较。
 */
function collectScaleDivergences(
  questions: ScaleQuestion[],
  answersA: AnswerMap | undefined,
  answersB: AnswerMap | undefined,
  dimensionCode: string,
): QuestionDivergence[] {
  const rows: QuestionDivergence[] = [];
  for (const question of questions) {
    if (question?.type !== 'scale') continue;
    if (question.dimensionCode !== dimensionCode) continue;
    const scoreA = readScaleAnswer(answersA, question.code);
    const scoreB = readScaleAnswer(answersB, question.code);
    if (scoreA === null || scoreB === null) continue;
    const gap = Math.abs(scoreA - scoreB);
    if (gap < SCALE_GAP_THRESHOLD) continue;
    rows.push({
      questionCode: question.code,
      dimensionCode,
      kind: 'scale_gap',
      scoreA,
      scoreB,
      optionA: null,
      optionB: null,
      gap,
    });
  }
  // 分差降序取前 2；分差相同时按题号升序，保证结果确定性
  rows.sort(
    (a, b) =>
      b.gap - a.gap || compareQuestionCodes(a.questionCode, b.questionCode),
  );
  return rows.slice(0, TOP_DIVERGENCE_LIMIT);
}

/**
 * 规则 3 选择题分歧：type === 'choice' 的题（Q3/Q37/Q38）不参与维度分，
 * 双方都已作答且选项键不同才算分歧（任一方未作答不算）。
 */
function collectChoiceDivergences(
  questions: ScaleQuestion[],
  answersA: AnswerMap | undefined,
  answersB: AnswerMap | undefined,
): QuestionDivergence[] {
  const rows: QuestionDivergence[] = [];
  for (const question of questions) {
    if (question?.type !== 'choice') continue;
    const optionA = readChoiceAnswer(answersA, question.code);
    const optionB = readChoiceAnswer(answersB, question.code);
    if (optionA === null || optionB === null) continue;
    if (optionA === optionB) continue;
    rows.push({
      questionCode: question.code,
      dimensionCode:
        typeof question.dimensionCode === 'string' ? question.dimensionCode : null,
      kind: 'option_differ',
      scoreA: null,
      scoreB: null,
      optionA,
      optionB,
      gap: CHOICE_DIVERGENCE_GAP,
    });
  }
  rows.sort((a, b) => compareQuestionCodes(a.questionCode, b.questionCode));
  return rows;
}

/**
 * 规则 6 + 假设 A-5：双方任一触发即整体触发，命中题号合并去重后按题号升序；
 * 文案统一取规格原文常量，双方同一文案、不含关系判词（P7 例外条款）。
 */
function mergeBaseline(
  a: BaselineResult | null | undefined,
  b: BaselineResult | null | undefined,
): BaselineResult {
  const triggered = a?.triggered === true || b?.triggered === true;
  const codes = new Set<string>();
  for (const source of [a?.triggeredCodes, b?.triggeredCodes]) {
    if (!Array.isArray(source)) continue;
    for (const code of source) {
      if (typeof code === 'string' && code !== '') codes.add(code);
    }
  }
  return {
    triggered,
    triggeredCodes: [...codes].sort(compareQuestionCodes),
    message: triggered ? BASELINE_NOTICE_MESSAGE : '',
  };
}

/**
 * 双人差值比对（PRD-002 R1 / R2）
 *
 * @returns 全部计分维度的分级对比、高共识 / 待沟通分区、选择题分歧清单、
 *          合并后的底线提示与双方质量标记
 */
export function compareDouble(input: {
  questions: ScaleQuestion[];
  dimensions: ScaleDimension[];
  resultA: SingleScoringResult;
  resultB: SingleScoringResult;
  answersA: AnswerMap;
  answersB: AnswerMap;
  rule: ScoringRuleConfig;
}): DoubleComparisonResult {
  const scoreMapA = toScoreMap(input?.resultA);
  const scoreMapB = toScoreMap(input?.resultB);
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const dimensionsInput = Array.isArray(input?.dimensions) ? input.dimensions : [];

  // 仅比对参与维度分的维度（底线题组 isScored=false，规则 6），按卷内顺序升序
  const scoredDimensions = dimensionsInput
    .filter(
      (dimension): dimension is ScaleDimension =>
        !!dimension && dimension.isScored === true && typeof dimension.code === 'string',
    )
    .sort((a, b) => orderNoOf(a) - orderNoOf(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  // 任一方缺该维度分（未评估 / 该维度零有效作答）→ **整维跳过**，绝不退化为 0 分兜底。
  // 历史实现用 MISSING_SCORE = 0 兜底，会凭空算出「分差 = 另一方的分」的假分歧，
  // 让用户看到双方根本没有分歧的「待沟通区」（违反 P7 不制造焦虑与 R2 的分歧定义）。
  // 该维度由调用方（double-report.engine）归入「未评估」，报告标注而不比对。
  const comparisons: DimensionComparison[] = [];
  for (const dimension of scoredDimensions) {
    const scoreA = scoreMapA.get(dimension.code);
    const scoreB = scoreMapB.get(dimension.code);
    if (scoreA === undefined || scoreB === undefined) continue;
    const gap = Math.round(Math.abs(scoreA - scoreB) * SCORE_FACTOR) / SCORE_FACTOR;
    const level = classifyGap(gap, input.rule);
    comparisons.push({
      dimensionCode: dimension.code,
      dimensionName: dimension.name ?? dimension.code,
      scoreA,
      scoreB,
      gap,
      level,
      levelLabel: resolveLevelLabel(input.rule, level),
      topDivergences: collectScaleDivergences(
        questions,
        input?.answersA,
        input?.answersB,
        dimension.code,
      ),
    });
  }

  return {
    dimensions: comparisons,
    consensusDimensions: comparisons.filter((item) => item.level === 'high'),
    pendingDimensions: comparisons.filter((item) => item.level !== 'high'),
    choiceDivergences: collectChoiceDivergences(
      questions,
      input?.answersA,
      input?.answersB,
    ),
    baseline: mergeBaseline(input?.resultA?.baseline, input?.resultB?.baseline),
    quality: { a: input?.resultA?.quality, b: input?.resultB?.quality },
  };
}
