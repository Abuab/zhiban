import { SCALE_VALUE_MAX, SCALE_VALUE_MIN } from '../../engines/scale/scale.constants.js';
import type { AnswerMap, QuestionOption, ScaleQuestion } from '../../engines/scale/scale.types.js';
import type { ScaleDimensionEntity } from '../scale/entities/scale-dimension.entity.js';
import type { ScaleQuestionEntity } from '../scale/entities/scale-question.entity.js';
import type { PaperDimension, PaperQuestion } from './assessment.types.js';

/**
 * 测评域映射与入参净化（纯函数，无副作用、无 DI）
 *
 * 为什么单独一层：
 *   1. 答案来自客户端，必须在落库前按「该题在锁定版本中的题型」逐题净化 —— 不可信输入
 *      一律丢弃而不是原样入库，否则 answered_count / 进度 / 计分三处口径会不一致；
 *   2. 净化规则必须与 L1 计分引擎的取值口径完全一致（量表题整数 1-5、二选一 A/B、选择题命中选项），
 *      单独成层便于单测穷举。
 */

/** 题目类型字面量（与 L1 引擎一致） */
const TYPE_SCALE = 'scale';
const TYPE_BINARY = 'binary';
const TYPE_CHOICE = 'choice';

/** 二选一题的两个端点（与 L1 引擎一致） */
const POLE_A = 'A';
const POLE_B = 'B';

/** 实体 → 对外题目（**剔除 ext_json 的考察点**：运营参考不外泄） */
export function toPaperQuestion(
  entity: ScaleQuestionEntity,
  dimensionCodeById: ReadonlyMap<number, string>,
): PaperQuestion {
  return {
    code: entity.code,
    orderNo: entity.orderNo,
    type: entity.type,
    title: entity.title,
    reverse: entity.reverse === 1,
    isStyle: entity.isStyle === 1,
    isBaseline: entity.isBaseline === 1,
    dimensionCode: entity.dimensionId === null ? null : (dimensionCodeById.get(entity.dimensionId) ?? null),
    options: (entity.optionsJson as QuestionOption[] | null) ?? null,
  };
}

/** 实体列表 → 对外题目列表（按 order_no 升序，答题顺序即此顺序） */
export function toPaperQuestions(
  entities: ScaleQuestionEntity[],
  dimensions: ScaleDimensionEntity[],
): PaperQuestion[] {
  const dimensionCodeById = new Map<number, string>(
    dimensions.map((dimension) => [dimension.id, dimension.code]),
  );
  return [...entities]
    .sort((a, b) => a.orderNo - b.orderNo)
    .map((entity) => toPaperQuestion(entity, dimensionCodeById));
}

/** 实体列表 → 对外维度列表（按 order_no 升序） */
export function toPaperDimensions(entities: ScaleDimensionEntity[]): PaperDimension[] {
  return [...entities]
    .sort((a, b) => a.orderNo - b.orderNo)
    .map((entity) => ({
      code: entity.code,
      name: entity.name,
      orderNo: entity.orderNo,
      isSensitive: entity.isSensitive === 1,
      isScored: entity.isScored === 1,
    }));
}

/**
 * 单题答案净化：返回合法答案，非法/越界/未作答一律返回 null。
 * 口径与 L1 计分引擎的 resolveScaleValue / resolveAnswerKey 保持一致，
 * 保证「服务端认为已答」与「引擎认为有效」是同一件事。
 */
export function normalizeAnswerValue(
  question: ScaleQuestion,
  raw: unknown,
): number | string | null {
  if (raw === undefined || raw === null) return null;

  if (question.type === TYPE_SCALE) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
    if (raw < SCALE_VALUE_MIN || raw > SCALE_VALUE_MAX) return null;
    return raw;
  }

  if (question.type === TYPE_BINARY) {
    return raw === POLE_A || raw === POLE_B ? raw : null;
  }

  if (question.type === TYPE_CHOICE) {
    if (typeof raw !== 'string' || raw === '') return null;
    if (!question.options || !question.options.some((option) => option.key === raw)) return null;
    return raw;
  }

  return null;
}

/** 净化结果：answers 为可落库的合法答案；ignoredCodes 为被丢弃的题号（未知题号、非法取值、已跳过维度） */
export interface SanitizeResult {
  answers: AnswerMap;
  ignoredCodes: string[];
}

/**
 * 按题目定义逐题净化客户端提交的答案。
 *
 * @param questions    锁定版本的题目（题目定义是唯一真源，不信任客户端传来的题型）
 * @param raw          客户端提交的 {题号: 答案}
 * @param excludedCodes 不应作答的题号（被跳过维度的题目）—— 即使客户端传了也丢弃，
 *                      避免「声明跳过又偷偷作答」导致报告口径矛盾
 */
export function sanitizeAnswers(
  questions: ScaleQuestion[],
  raw: Record<string, unknown> | undefined,
  excludedCodes: ReadonlySet<string> = new Set<string>(),
): SanitizeResult {
  const answers: AnswerMap = {};
  const ignoredCodes: string[] = [];
  if (!raw) return { answers, ignoredCodes };

  const questionByCode = new Map<string, ScaleQuestion>(
    questions.map((question) => [question.code, question]),
  );

  for (const [code, value] of Object.entries(raw)) {
    const question = questionByCode.get(code);
    if (!question || excludedCodes.has(code)) {
      ignoredCodes.push(code);
      continue;
    }
    const normalized = normalizeAnswerValue(question, value);
    if (normalized === null) {
      ignoredCodes.push(code);
      continue;
    }
    answers[code] = normalized;
  }

  return { answers, ignoredCodes };
}

/** 维度编码解析结果：skipped 为合法且去重后的编码；invalid 为不合法编码（调用方据此拒绝请求） */
export interface SkippedDimensionResult {
  skipped: string[];
  invalid: string[];
}

/**
 * 解析客户端申报的「跳过维度」。
 *
 * 只接受**敏感维度**（is_sensitive = 1）的编码：B7 的跳过权来源于隐私约束 2.4
 * 「高敏感题目维度须单独勾选同意」，普通维度不享有跳过权 —— 否则用户可以跳过任意维度
 * 来回避作答。非法编码一律由调用方拒绝（fail-closed），不做静默忽略。
 */
export function resolveSkippedDimensions(
  dimensions: ScaleDimensionEntity[],
  raw: string[] | undefined,
): SkippedDimensionResult {
  if (!raw || raw.length === 0) return { skipped: [], invalid: [] };

  const sensitiveCodes = new Set(
    dimensions.filter((dimension) => dimension.isSensitive === 1).map((dimension) => dimension.code),
  );

  const skipped: string[] = [];
  const invalid: string[] = [];
  for (const code of raw) {
    if (!sensitiveCodes.has(code)) {
      invalid.push(code);
      continue;
    }
    if (!skipped.includes(code)) skipped.push(code);
  }

  return { skipped, invalid };
}

/** 被跳过维度所覆盖的题号集合 */
export function collectSkippedQuestionCodes(
  questions: ScaleQuestion[],
  skippedDimensions: string[],
): Set<string> {
  if (skippedDimensions.length === 0) return new Set<string>();
  const skippedSet = new Set(skippedDimensions);
  return new Set(
    questions
      .filter((question) => question.dimensionCode !== null && skippedSet.has(question.dimensionCode))
      .map((question) => question.code),
  );
}

/** 题号解析结果：skipped 为合法且去重后的题号；invalid 为不合法题号（调用方据此拒绝请求） */
export interface SkippedQuestionResult {
  skipped: string[];
  invalid: string[];
}

/**
 * 解析客户端申报的「逐题跳过」（ADR-013）。
 *
 * 白名单（fail-closed，与 resolveSkippedDimensions 同口径）只接受**同时满足**两个条件的题号：
 *   1. 题号存在于该卷锁定的量表版本（题目定义是唯一真源）；
 *   2. 该题所属维度 is_sensitive = 1（当前唯一敏感维度为维度 8「亲密与关系期待」）。
 * 任一不满足即视为非法，由调用方拒绝请求，**不做静默忽略**。
 *
 * 为什么必须用库里的 is_sensitive 判定而不是硬编码题号区间：题库改版后硬编码立刻失效；
 * 且硬编码会把底线题（is_baseline，dimension_id 为空）与风格题一并误开放跳过 ——
 * 底线题的触发规则（R5 / B9）一旦可被绕过，产品红线即被击穿。
 */
export function resolveSkippedQuestions(
  questions: ScaleQuestion[],
  dimensions: ScaleDimensionEntity[],
  raw: string[] | undefined,
): SkippedQuestionResult {
  if (!raw || raw.length === 0) return { skipped: [], invalid: [] };

  const sensitiveCodes = new Set(
    dimensions.filter((dimension) => dimension.isSensitive === 1).map((dimension) => dimension.code),
  );
  const questionByCode = new Map<string, ScaleQuestion>(
    questions.map((question) => [question.code, question]),
  );

  const skipped: string[] = [];
  const invalid: string[] = [];
  for (const code of raw) {
    const question = questionByCode.get(code);
    const answerable =
      question !== undefined &&
      question.dimensionCode !== null &&
      sensitiveCodes.has(question.dimensionCode);
    if (!answerable) {
      invalid.push(code);
      continue;
    }
    if (!skipped.includes(code)) skipped.push(code);
  }

  return { skipped, invalid };
}

/**
 * 互斥检查：返回同时被「整维跳过」与「逐题跳过」覆盖的维度编码（非空即应拒绝请求）。
 * 二者是两种不同的产品动作（整维拒绝授权 vs 已授权但个别题不愿答），语义不能重叠（ADR-013 决策 1）。
 */
export function findSkippedDimensionConflicts(
  questions: ScaleQuestion[],
  skippedDimensions: string[],
  skippedQuestionCodes: string[],
): string[] {
  if (skippedDimensions.length === 0 || skippedQuestionCodes.length === 0) return [];
  const questionCodeSet = new Set(skippedQuestionCodes);
  return skippedDimensions.filter((dimensionCode) =>
    questions.some(
      (question) => question.dimensionCode === dimensionCode && questionCodeSet.has(question.code),
    ),
  );
}

/**
 * 两个跳过集合（维度级 + 题级）的题号并集。
 * 进度分母、交卷完整性校验、补答范围三处**必须共用同一口径**，否则会出现
 * 「进度算作不需要答、交卷却要求答」这类自相矛盾。
 */
export function collectAllSkippedQuestionCodes(
  questions: ScaleQuestion[],
  skippedDimensions: string[],
  skippedQuestionCodes: string[],
): Set<string> {
  const codes = collectSkippedQuestionCodes(questions, skippedDimensions);
  for (const code of skippedQuestionCodes) codes.add(code);
  return codes;
}

/** 进度：分母扣除被跳过维度的题数（A-1 的分母在无跳过时即 itemCount） */
export interface ProgressResult {
  answeredCount: number;
  totalCount: number;
  progressPercent: number;
}

/** 计算进度（分子只算「需作答且已作答」的题，被跳过维度既不入分母也不入分子） */
export function buildProgress(
  questions: ScaleQuestion[],
  answers: AnswerMap,
  skippedQuestionCodes: ReadonlySet<string>,
): ProgressResult {
  let totalCount = 0;
  let answeredCount = 0;
  for (const question of questions) {
    if (skippedQuestionCodes.has(question.code)) continue;
    totalCount += 1;
    if (answers[question.code] !== undefined) answeredCount += 1;
  }
  const progressPercent =
    totalCount === 0 ? 0 : Math.round((answeredCount / totalCount) * 100);
  return { answeredCount, totalCount, progressPercent };
}

/** 未作答题号（按卷内顺序升序）；用于交卷前的完整性校验（ANSWER_INCOMPLETE） */
export function findMissingQuestionCodes(
  questions: ScaleQuestion[],
  answers: AnswerMap,
  skippedQuestionCodes: ReadonlySet<string>,
): string[] {
  return [...questions]
    .sort((a, b) => a.orderNo - b.orderNo)
    .filter((question) => !skippedQuestionCodes.has(question.code))
    .filter((question) => answers[question.code] === undefined)
    .map((question) => question.code);
}
