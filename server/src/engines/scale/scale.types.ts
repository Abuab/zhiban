/**
 * L1 领域引擎层 · 量表领域类型
 *
 * 本文件只描述**纯数据结构**，禁止 import 数据库/HTTP 相关模块。
 * 依据 docs/architecture.md §2「依赖规则（硬约束）」第 1 条：
 *   L1 引擎层禁止依赖数据库/HTTP，只接受纯数据结构入参
 *   → 保证 8 条计分规则可 100% 单元测试（模块 3 完成标准）
 *
 * 规格依据：
 * - 题库 v1.0 第一部分（79 题表，实际 76 题）、第二部分（16 型 24 题）、第三部分（计分与判定规则 8 条）
 * - 阶段 0 裁决 D-2：维度分 = (均分 - 1) × 25，区间 0-100
 * - 阶段 0 裁决 D-3：题数以实际列出的 76 题为准（71 维度题含 Q27 风格题 + 5 底线题）
 * - 假设 A-7：16 型「=3 平局」统一取 B 端并记录平局标记
 */

/** 题型：量表 / 选择 / 二选一（A-B） */
export type QuestionType = 'scale' | 'choice' | 'binary';

/** 单个选项（选择题为 ①②③…；二选一题为 A / B 两端点文案） */
export interface QuestionOption {
  /** 选项键：选择题 '1'..'5'；二选一 'A' / 'B' */
  key: string;
  /** 选项文案 */
  label: string;
}

/** 维度定义 */
export interface ScaleDimension {
  /** 维度编码，如 FINANCE / HOUSING / INTIMACY；底线题组为 BASELINE */
  code: string;
  /** 维度名，如「财务观与婚俗财务」 */
  name: string;
  /** 卷内顺序（从 1 开始） */
  orderNo: number;
  /** 敏感维度（前置单独同意页，B7）：仅维度 8 */
  isSensitive: boolean;
  /** 是否参与维度分：底线题组为 false（规则 6「不参与维度分」） */
  isScored: boolean;
}

/** 题目定义 */
export interface ScaleQuestion {
  /** 题号：婚前评估 Q1-Q76；16 型 P1-P24 */
  code: string;
  /** 卷内顺序（答题进度以此排序，A-1：分母 = 题目总数） */
  orderNo: number;
  /** 所属维度编码；底线题组为 null（独立呈现） */
  dimensionCode: string | null;
  /** 题型 */
  type: QuestionType;
  /** 题干 */
  title: string;
  /** 反向题：计分时 6 - 原值（规则 1） */
  reverse: boolean;
  /** 风格题：不计入维度分（Q27，规则 2） */
  isStyle: boolean;
  /** 底线题组（Q72-Q76，规则 6） */
  isBaseline: boolean;
  /** 选项列表：量表题为 null（固定 1-5）；选择题/二选一题必填 */
  options: QuestionOption[] | null;
  /** 考察点（规格表格最后一列，仅作运营参考，不参与计分） */
  note?: string;
}

/** 一个量表版本的完整定义（题库种子，供导入脚本写库） */
export interface ScaleVersionSeed {
  /** 量表编码：SCALE-PRE（婚前评估）/ SCALE-16P（16 型人格图谱） */
  scaleCode: string;
  /** 量表名称 */
  scaleName: string;
  /** 量表描述 */
  scaleDescription: string;
  /** 版本号，如 '1.0'（规格：SCALE-PRE-1.0 / SCALE-16P-1.0） */
  version: string;
  /** 题目总数（导入时与 questions.length 核对，用于出题数核对） */
  itemCount: number;
  /** 卷首固定文案（作答说明） */
  introText: string;
  dimensions: ScaleDimension[];
  questions: ScaleQuestion[];
}

/**
 * 答案映射：题号 → 原始答案
 * - 量表题（含风格题、底线题）：数字 1-5（很不同意=1 … 很同意=5）
 * - 选择题：选项键字符串 '1'..'5'
 * - 二选一题：'A' / 'B'
 */
export type AnswerMap = Record<string, number | string>;

/** 计分规则配置（对应 scoring_rule 表；引擎只接受纯数据，由调用方从库读出后传入） */
export interface ScoringRuleConfig {
  /** 聚合方式：mean_normalized = (均分 - 1) × 25（D-2） */
  aggregateMethod: 'mean_normalized';
  /** 差值下限（含），归入较低一级（D6）：默认 15 */
  diffThresholdHigh: number;
  /** 差值上限（含），归入较低一级（D6）：默认 30 */
  diffThresholdMid: number;
  /** 分级命名（中性，P7） */
  labels: {
    /** 高共识（gap < diffThresholdHigh） */
    high: string;
    /** 待沟通（diffThresholdHigh ≤ gap ≤ diffThresholdMid） */
    mid: string;
    /** 重点待沟通（gap > diffThresholdMid） */
    low: string;
  };
  /** 低质量判定：作答总时长低于该秒数即标记（B3：默认 180 秒） */
  qualityMinSec: number;
}

/** 单个维度得分 */
export interface DimensionScore {
  dimensionCode: string;
  dimensionName: string;
  /** 0-100 分（(均分 - 1) × 25，保留 1 位小数） */
  score: number;
  /** 参与计分的题数（不含风格题与下架题） */
  scoredCount: number;
}

/** 作答质量标记（规则 7 / B3 / B4） */
export interface QualityFlag {
  /** 是否低质量：总时长不足 或 全部同值 */
  isLowQuality: boolean;
  /** 命中原因 */
  reasons: Array<'too_fast' | 'all_same'>;
  /** 作答总时长（秒） */
  durationSec: number;
}

/** 底线题组结果（规则 6 / R5 / B9） */
export interface BaselineResult {
  /** 是否触发核实提示（任一底线题作答 1-2 分） */
  triggered: boolean;
  /** 触发题号（升序） */
  triggeredCodes: string[];
  /** 提示文案（规格原文，中性、不含判词，落实 P7 例外条款） */
  message: string;
}

/** 单人计分结果 */
export interface SingleScoringResult {
  dimensions: DimensionScore[];
  quality: QualityFlag;
  baseline: BaselineResult;
  /** 风格题作答（Q27），供报告个性化；未作答为 null */
  styleAnswer: { code: string; value: number } | null;
}

/** 逐题分歧类型：量表题分差 ≥3（规则 4）/ 选择题选项不同（规则 3） */
export type DivergenceKind = 'scale_gap' | 'option_differ';

/** 逐题分歧 */
export interface QuestionDivergence {
  questionCode: string;
  dimensionCode: string | null;
  kind: DivergenceKind;
  /** 量表题分值（未作答为 null） */
  scoreA: number | null;
  scoreB: number | null;
  /** 选择/二选一题选项键（未作答为 null） */
  optionA: string | null;
  optionB: string | null;
  /** 绝对分差：量表题为 |A-B|；选择题固定为 0（选项不同即分歧） */
  gap: number;
}

/** 维度对比结果（差值分级，规则 5） */
export interface DimensionComparison {
  dimensionCode: string;
  dimensionName: string;
  scoreA: number;
  scoreB: number;
  /** 分差 = |scoreA - scoreB| */
  gap: number;
  /** 分级：high 高共识 / mid 待沟通 / low 重点待沟通 */
  level: 'high' | 'mid' | 'low';
  /** 分级文案（取自 ScoringRuleConfig.labels） */
  levelLabel: string;
  /** 该维度分差最大的前 2 题（规则 4：按分差降序取前 2） */
  topDivergences: QuestionDivergence[];
}

/** 双方对比结果（PRD-002 R1 / R2 / D6） */
export interface DoubleComparisonResult {
  /** 全部计分维度的对比（按维度顺序） */
  dimensions: DimensionComparison[];
  /** 高共识维度 */
  consensusDimensions: DimensionComparison[];
  /** 待沟通 + 重点待沟通维度 */
  pendingDimensions: DimensionComparison[];
  /** 选择/二选一题的分歧清单（Q3/Q37/Q38，规则 3；无维度归属） */
  choiceDivergences: QuestionDivergence[];
  /** 底线题组提示（双方任一触发即提示，同一文案，A-5） */
  baseline: BaselineResult;
  /** 双方质量标记（C10：仅在报告内统一提示，不单独暴露明细） */
  quality: { a: QualityFlag; b: QualityFlag };
}

/** 16 型维度端点 */
export type P16Pole = 'A' | 'B';

/** 16 型单维度结果（规则 8） */
export interface P16DimensionResult {
  dimensionCode: string;
  pole: P16Pole;
  /** A 端选择数 */
  aCount: number;
  /** B 端选择数 */
  bCount: number;
  /** 是否平局（=3，A-7：取 B 端并记录平局标记） */
  isTie: boolean;
}

/** 16 型计分结果 */
export interface P16Result {
  dimensions: P16DimensionResult[];
  /** 类型组合键，如 'B|B|A|A'（能量|信息|决策|生活） */
  typeKey: string;
  /** 自研类型名，如「守序者」（UI 不出现官方代号） */
  typeName: string;
}
