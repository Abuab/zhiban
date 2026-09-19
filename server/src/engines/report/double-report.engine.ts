/**
 * L1 领域引擎层 · 双人对比报告数据构建
 *
 * 纯函数：入参全为纯数据结构，禁止依赖 DB / HTTP / NestJS（architecture.md §2 依赖规则）。
 * 职责边界：
 *   - 本引擎只负责「把两份单人快照合成为一份对比结论」（差值分级 / 待沟通区 / 共识区 / 逐题分歧）
 *   - 文案渲染由模板引擎负责（engines/report/template.engine.ts），落库由模块层负责
 *
 * 规格依据：
 * - PRD-002 R1（差值分级，阈值后台可配、D6 边界归低一级）→ 复用 diff.engine 的 compareDouble
 * - PRD-002 R2（逐题分歧：同题 |分差| ≥3，每维度按分差降序取前 2）
 * - PRD-002 R5（底线题双向提示，同一文案，假设 A-5）
 * - 规范增补 v0.2 §3.1：L1 完整版含「双人雷达图、各维度差值、待沟通区明细、逐题分歧」
 * - ADR-005 决策 7：被跳过（未评估）维度**不参与差值比对**，报告统一标注「未评估」
 *
 * ⚠️ R4（双方答案互不可见）与本引擎的关系：
 *   L1 的「逐题分歧」由规范增补 v0.2（优先级高于 PRD）明确授予发起方，
 *   故本引擎在 flaggedItems 中保留双方在**分歧题**上的作答；
 *   但 R4 约束的「对方完整答卷」在任何层级都不存在出口 —— 快照只在服务端参与计算，从不整体下发。
 */
import { compareDouble } from '../scale/diff.engine.js';
import type {
  AnswerMap,
  BaselineResult,
  DivergenceKind,
  QualityFlag,
  QuestionDivergence,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
  SingleScoringResult,
} from '../scale/scale.types.js';

/** 差值档位（与 ScoringRuleConfig.labels 的键一一对应） */
export type GapLevel = 'high' | 'mid' | 'low';

/** 单方参与者的对比输入（由模块层从 answer_snapshot 的不可变快照映射而来） */
export interface DoubleParticipantSnapshot {
  /** 该方昵称（渲染用；为空时由模块层给出兜底文案） */
  nickname: string;
  /** 该方原始答案（逐题分歧比对需要） */
  answers: AnswerMap;
  /** 该方已评估维度的分值（未评估维度不出现；已答题数由题目定义现算） */
  dimensionScores: Array<{ dimensionCode: string; score: number }>;
  /** 该方被跳过（未评估）的维度编码 */
  skippedDimensions: string[];
  quality: QualityFlag;
  baseline: BaselineResult;
}

/** L1 维度行（双人雷达图 + 差值） */
export interface DoubleDimensionRow {
  dimensionCode: string;
  dimensionName: string;
  scoreA: number;
  scoreB: number;
  gap: number;
  level: GapLevel;
  levelLabel: string;
}

/** 逐题分歧条目（补题干与选项文案，使历史报告不随题库改版而失去可读性） */
export interface DoubleFlaggedItem {
  questionCode: string;
  questionTitle: string;
  dimensionCode: string | null;
  dimensionName: string | null;
  kind: DivergenceKind;
  gap: number;
  scoreA: number | null;
  scoreB: number | null;
  optionLabelA: string | null;
  optionLabelB: string | null;
}

/** 共识区条目（双方选项一致的题目，仅呈现一致项，不含任何差异信息） */
export interface DoubleConsensusItem {
  questionCode: string;
  questionTitle: string;
  optionKey: string;
  optionLabel: string;
}

/** 双人对比报告数据（落库与渲染共用的中间结构） */
export interface DoubleReportData {
  /** 已参与比对的维度（按卷内顺序） */
  dimensions: DoubleDimensionRow[];
  /** 高共识维度（level = high） */
  consensusDimensions: DoubleDimensionRow[];
  /** 待沟通 + 重点待沟通维度 */
  pendingDimensions: DoubleDimensionRow[];
  /** 任一方未评估的维度（ADR-005 决策 7：不参与比对，报告标注「未评估」） */
  unevaluatedDimensions: Array<{ dimensionCode: string; dimensionName: string }>;
  /** 量表题分歧（按维度分组前的扁平清单，每维度已按分差降序取前 2） */
  scaleDivergences: DoubleFlaggedItem[];
  /** 选择/二选一题分歧（无维度归属） */
  choiceDivergences: DoubleFlaggedItem[];
  /** 共识区：双方选项一致的题目（仅正向） */
  consensusItems: DoubleConsensusItem[];
  /** 底线题提示（双方任一触发即提示，同一文案） */
  baseline: BaselineResult;
  /** 双方质量标记（C10：只在报告内统一提示，不单独暴露明细） */
  quality: { a: QualityFlag; b: QualityFlag };
}

/** 快照 → 引擎计分结果（只取 diff.engine 需要的字段，风格题不参与比对） */
function toScoringResult(
  snapshot: DoubleParticipantSnapshot,
  scoredCountByCode: ReadonlyMap<string, number>,
): SingleScoringResult {
  return {
    dimensions: snapshot.dimensionScores.map((row) => ({
      dimensionCode: row.dimensionCode,
      dimensionName: row.dimensionCode,
      score: row.score,
      // 已作答题数由本题卷题目定义现算（快照只存维度分，不存计数）
      scoredCount: scoredCountByCode.get(row.dimensionCode) ?? 0,
    })),
    quality: snapshot.quality,
    baseline: snapshot.baseline,
    styleAnswer: null,
  };
}

/**
 * 统计各维度**已作答**的量表题数（1-5 分内的合法数值）
 * 用途：填充 SingleScoringResult.dimensionScore.scoredCount
 * 注意取值口径必须与 diff.engine 一致（越界/缺失一律视为未作答），
 *      否则「已答 6/6」这类展示会与实际比对口径打架。
 */
function countScoredAnswers(
  questions: ScaleQuestion[],
  answers: AnswerMap | undefined,
): Map<string, number> {
  const counter = new Map<string, number>();
  for (const question of questions) {
    if (question?.type !== 'scale') continue;
    const dimensionCode = question.dimensionCode;
    if (typeof dimensionCode !== 'string' || dimensionCode === '') continue;
    const raw = answers?.[question.code];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1 || raw > 5) continue;
    counter.set(dimensionCode, (counter.get(dimensionCode) ?? 0) + 1);
  }
  return counter;
}

/** 选项键 → 选项文案（选项定义缺失时退化为选项键，保证信息不丢） */
function optionLabel(question: ScaleQuestion, key: string | null): string | null {
  if (key === null) return null;
  const matched = question.options?.find((option) => option.key === key);
  return matched ? matched.label : key;
}

/** 维度编码 → 维度名（维度定义缺失时退化为编码） */
function dimensionNameOf(dimensionCode: string | null, nameByCode: ReadonlyMap<string, string>): string | null {
  if (dimensionCode === null) return null;
  return nameByCode.get(dimensionCode) ?? dimensionCode;
}

/** 补齐题干/选项文案，得到可长期渲染的分歧条目 */
function toFlaggedItem(
  divergence: QuestionDivergence,
  questionByCode: ReadonlyMap<string, ScaleQuestion>,
  nameByCode: ReadonlyMap<string, string>,
): DoubleFlaggedItem {
  const question = questionByCode.get(divergence.questionCode);
  return {
    questionCode: divergence.questionCode,
    // 题库改版后题目可能已不存在：退化为题号，绝不抛错（历史报告必须仍可打开，D5）
    questionTitle: question?.title ?? divergence.questionCode,
    dimensionCode: divergence.dimensionCode,
    dimensionName: dimensionNameOf(divergence.dimensionCode, nameByCode),
    kind: divergence.kind,
    gap: divergence.gap,
    scoreA: divergence.scoreA,
    scoreB: divergence.scoreB,
    optionLabelA: question ? optionLabel(question, divergence.optionA) : divergence.optionA,
    optionLabelB: question ? optionLabel(question, divergence.optionB) : divergence.optionB,
  };
}

/**
 * 共识区：选择/二选一题中双方作答一致的题目（仅正向，不给差异信息）。
 * 双方答案一致本身不构成信息泄露（R4 保护的是「对方的独立答案」），
 * 且它是 L2 基础版唯一的实质内容来源（规范增补 v0.2 §3.1）。
 */
function collectConsensusItems(
  questions: ScaleQuestion[],
  answersA: AnswerMap,
  answersB: AnswerMap,
): DoubleConsensusItem[] {
  const items: DoubleConsensusItem[] = [];
  for (const question of questions) {
    if (question?.type !== 'choice') continue;
    const rawA = answersA?.[question.code];
    const rawB = answersB?.[question.code];
    if (rawA === undefined || rawB === undefined) continue;
    const keyA = String(rawA);
    const keyB = String(rawB);
    if (keyA !== keyB) continue;
    items.push({
      questionCode: question.code,
      questionTitle: question.title,
      optionKey: keyA,
      optionLabel: optionLabel(question, keyA) ?? keyA,
    });
  }
  return items;
}

/**
 * 构建双人对比报告数据
 *
 * @param input.dimensions 该量表版本的全部维度（含底线题组；本函数内部自行过滤）
 * @param input.questions  该量表版本的全部题目（用于补齐题干与选项文案）
 */
export function buildDoubleReportData(input: {
  questions: ScaleQuestion[];
  dimensions: ScaleDimension[];
  initiator: DoubleParticipantSnapshot;
  invitee: DoubleParticipantSnapshot;
  rule: ScoringRuleConfig;
}): DoubleReportData {
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const dimensions = Array.isArray(input?.dimensions) ? input.dimensions : [];
  const initiator = input.initiator;
  const invitee = input.invitee;

  const nameByCode = new Map(dimensions.map((item) => [item.code, item.name]));
  const questionByCode = new Map(questions.map((item) => [item.code, item]));

  // ADR-005 决策 7：任一方未评估的维度都不参与比对（否则会把「未评估」当成 0 分算出差值）
  const unevaluatedCodes = new Set([
    ...initiator.skippedDimensions,
    ...invitee.skippedDimensions,
  ]);
  const comparableDimensions = dimensions.filter(
    (dimension) => dimension.isScored === true && !unevaluatedCodes.has(dimension.code),
  );

  const comparison = compareDouble({
    questions,
    dimensions: comparableDimensions,
    resultA: toScoringResult(initiator, countScoredAnswers(questions, initiator.answers)),
    resultB: toScoringResult(invitee, countScoredAnswers(questions, invitee.answers)),
    answersA: initiator.answers,
    answersB: invitee.answers,
    rule: input.rule,
  });

  const dimensionsRows: DoubleDimensionRow[] = comparison.dimensions.map((row) => ({
    dimensionCode: row.dimensionCode,
    dimensionName: row.dimensionName,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    gap: row.gap,
    level: row.level,
    levelLabel: row.levelLabel,
  }));

  const scaleDivergences = comparison.dimensions.flatMap((row) =>
    row.topDivergences.map((item) => toFlaggedItem(item, questionByCode, nameByCode)),
  );

  return {
    dimensions: dimensionsRows,
    consensusDimensions: dimensionsRows.filter((row) => row.level === 'high'),
    pendingDimensions: dimensionsRows.filter((row) => row.level !== 'high'),
    unevaluatedDimensions: dimensions
      .filter((dimension) => dimension.isScored === true && unevaluatedCodes.has(dimension.code))
      .map((dimension) => ({
        dimensionCode: dimension.code,
        dimensionName: dimension.name ?? dimension.code,
      })),
    scaleDivergences,
    choiceDivergences: comparison.choiceDivergences.map((item) =>
      toFlaggedItem(item, questionByCode, nameByCode),
    ),
    consensusItems: collectConsensusItems(questions, initiator.answers, invitee.answers),
    baseline: comparison.baseline,
    quality: comparison.quality,
  };
}
