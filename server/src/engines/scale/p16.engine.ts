/**
 * L1 领域引擎层 · 16 型人格图谱（SCALE-16P）计分引擎
 *
 * 实现规格《题库 v1.0 第三部分：计分与判定规则》第 8 条（constitution.md L503）：
 *   每维度 6 题，统计 A 端选择数：≥4 取 A 端，≤2 取 B 端，=3 时取该维度中点偏向（记录平局标记）。
 *   四维度组合映射类型名（类型命名表见 constitution.md L473-490）。
 *
 * - 阶段 0 裁决 A-7（docs/architecture.md L358）：题库只写「中点偏向」未定义，
 *   统一取 B 端并记录 isTie 标记，与 16 型命名表首列（B 端组合）自洽。
 *
 * 硬约束（docs/architecture.md §2）：只接受纯数据结构入参，禁止 import DB / HTTP / NestJS 模块。
 */
import { P16_POLE_A_MIN, P16_POLE_B_MAX, P16_TYPE_NAMES } from './scale.constants.js';
import type {
  AnswerMap,
  P16DimensionResult,
  P16Pole,
  P16Result,
  ScaleDimension,
  ScaleQuestion,
} from './scale.types.js';

/** A / B 两端点（scale.types.ts 的 P16Pole 字面量） */
const P16_POLE_A: P16Pole = 'A';
const P16_POLE_B: P16Pole = 'B';

/** typeKey 各维度端点连接符（如 'B|B|A|A'） */
const P16_TYPE_KEY_SEPARATOR = '|';

/** 平局档 = 位于 A 端阈值与 B 端阈值之间的唯一取值（=3），由常量推导避免字面量 */
const P16_TIE_COUNT = P16_POLE_B_MAX + 1;

/** 解析二选一答案：仅接受 'A' / 'B'，其余（含数字、'C'、null）视为未作答 */
function resolvePole(raw: number | string | undefined): P16Pole | null {
  return raw === P16_POLE_A || raw === P16_POLE_B ? raw : null;
}

/**
 * 16 型计分（规则 8）。
 *
 * @param input.questions  24 道二选一题（type === 'binary'，答案为 'A' / 'B'）
 * @param input.dimensions 四个维度定义（ENERGY / INFO / DECISION / LIFESTYLE）
 * @param input.answers    题号 → 原始答案
 */
export function scoreP16(input: {
  questions: ScaleQuestion[];
  dimensions: ScaleDimension[];
  answers: AnswerMap;
}): P16Result {
  const { questions, dimensions, answers } = input;

  // 维度顺序按 orderNo 升序 → typeKey 顺序即「能量|信息|决策|生活」
  const orderedDimensions = [...dimensions].sort((a, b) => a.orderNo - b.orderNo);

  const dimensionResults: P16DimensionResult[] = orderedDimensions.map((dimension) => {
    const items = questions.filter(
      (question) => question.type === 'binary' && question.dimensionCode === dimension.code,
    );

    let aCount = 0;
    let answeredCount = 0;
    for (const question of items) {
      const pole = resolvePole(answers[question.code]);
      if (pole === null) continue; // 未作答 / 非法答案：忽略
      answeredCount += 1;
      if (pole === P16_POLE_A) aCount += 1;
    }
    const bCount = answeredCount - aCount;

    let pole: P16Pole;
    let isTie = false;
    if (answeredCount === 0) {
      // 未作答兜底（不属规格情形）：无任何有效答案时判 B 端且不计平局
      pole = P16_POLE_B;
    } else if (aCount >= P16_POLE_A_MIN) {
      pole = P16_POLE_A;
    } else if (aCount <= P16_POLE_B_MAX) {
      pole = P16_POLE_B;
    } else if (aCount === P16_TIE_COUNT) {
      // aCount === P16_TIE_COUNT（=3）：规格写「中点偏向」未定义，
      // 按阶段 0 裁决 A-7（docs/architecture.md L358）取 B 端并记录平局标记
      pole = P16_POLE_B;
      isTie = true;
    } else {
      // 兜底分支：aCount 由已答题数统计而来，上面的分支已覆盖 0-2 与 ≥4，此处不可达
      pole = P16_POLE_B;
    }

    return { dimensionCode: dimension.code, pole, aCount, bCount, isTie };
  });

  const typeKey = dimensionResults.map((result) => result.pole).join(P16_TYPE_KEY_SEPARATOR);

  return {
    dimensions: dimensionResults,
    typeKey,
    typeName: P16_TYPE_NAMES[typeKey] ?? '',
  };
}
