/**
 * 测评域前端常量
 * 原则：只放**结构性常量与规格已固定的文案**；随运营变化的文案一律由服务端下发
 *   （卷首说明 introText、维度点评、付费墙文案、页脚免责声明 —— 见宪法 P5）。
 */

/** 场景取值（与 type StartableScene 同源，避免业务代码出现裸字符串） */
export const SCENE_SINGLE = 'single';
export const SCENE_P16 = 'p16';

/**
 * 量表题 5 点刻度文案（下标 1-4 → 分值 1-5）
 *
 * 规格依据：constitution.md L496「量表题：很不同意=1 … 很同意=5」——
 *   规格只给出两端原词，中间三档文案由产品确认后固化在本常量中。
 * 客户端与计分口径一致：分值即数组下标 + 1。
 */
export const SCALE_POINT_LABELS: readonly string[] = [
  '很不同意',
  '不同意',
  '一般',
  '同意',
  '很同意',
];

/** 量表题分值范围（与引擎 SCALE_VALUE_MIN / MAX 一致） */
export const SCALE_VALUE_MIN = 1;
export const SCALE_VALUE_MAX = 5;

/**
 * 本地草稿缓存键前缀（B2 弱网/提交失败：答案本地缓存，联网自动补传）
 * 仅缓存答案与草稿版本号，不缓存任何身份信息
 */
export const DRAFT_STORAGE_KEY_PREFIX = 'zhiban:assessment-draft:';

/** 报告页雷达图的维度上限（单场景 8 维；超出不绘制，避免图形失真） */
export const RADAR_MAX_DIMENSIONS = 8;

// ===================================================================
// 敏感题「逐题不回答」（规格依据：ADR-013 决策 7 + 十、风险表）
// 全部文案必须中性：只陈述「可以不做 / 不计入得分 / 不影响看报告」的事实，
// 不含任何关系判词（P7 禁词清单）
// ===================================================================

/** 敏感题提示条：题目上方，仅敏感维度内且该维度未被整维跳过时出现 */
export const SENSITIVE_QUESTION_HINT = '这道题比较私密，你可以选择不回答';

/** 提示条右侧的逐题出口按钮 */
export const SKIP_QUESTION_ACTION = '不愿回答';

/** 已跳过态的说明（替换量表选项区） */
export const SKIPPED_QUESTION_NOTICE = '这题你选择了不回答';

/** 已跳过态里的撤销按钮（ADR-013 §八：撤销即从本地集合移除，随下次草稿提交同步） */
export const UNSKIP_QUESTION_ACTION = '改主意，回答这题';

/**
 * 交卷前的中性提示（ADR-013 决策 7 / §八）
 * 带题数，故用函数生成；存在跳过题时展示，但**不得**因此禁用交卷按钮
 * （ADR-013 决策 6：被跳过的题不阻塞交卷，否则「不愿回答」是假选项）
 */
export function buildSkippedSummaryText(count: number): string {
  return `有 ${count} 题你选择了不回答，将不计入该维度的得分，也不影响你查看报告`;
}

/**
 * 未评估维度的中性说明（ADR-013 决策 3 / 十、风险表）
 * 维度零有效作答（整维拒绝授权，或维度内每道题都被逐题跳过）时，
 * 报告只给这句说明，绝不展示 0 分、也不绘制空雷达轴（ADR-004 决策 2）
 */
export const DIMENSION_UNEVALUATED_NOTICE = '这部分你选择了不回答，因此没有结果';

/**
 * 维度行「计入 x / y 题」（ADR-013 决策 4）
 * 只做聚合的事实陈述，**不指明是与否**、也不透露具体跳过了哪几题（ADR-013 决策 5）。
 * 端上仅在 answeredCount < scoredCount 时展示，避免给全部答完的用户增加噪音。
 */
export function buildDimensionAnsweredText(answeredCount: number, scoredCount: number): string {
  return `计入 ${answeredCount} / ${scoredCount} 题`;
}

// ===================================================================
// 单人报告页顶部高亮卡（规格依据：ADR-010 决策 4「入口策略」）
// 触发条件只读报告既有字段 baselineNotice，端上不做任何推断
// ===================================================================

/** 高亮卡主文案 */
export const SAFETY_ENTRY_CARD_TITLE = '一起做一次婚前事实确认';

/** 高亮卡跳转按钮文案（目标页路径见 constants/safety.ts 的 SAFETY_PAGE_PATH） */
export const SAFETY_ENTRY_CARD_ACTION = '前往隐私与安全检查';
