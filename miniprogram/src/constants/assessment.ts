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
