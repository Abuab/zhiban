/**
 * 报告域常量（模块 5 扩展）
 *
 * 原则（宪法 P5）：可见文案一律落 `report_template` / `report_template_block`，
 * 本文件只放**结构性标识**（状态取值、区块键、占位符名）与**结构性阈值**，
 * 不放任何面向用户的句子。
 *
 * 规格依据：
 * - PRD-002 R3 三层可见 / R5 底线题双向提示 / R6 生成状态轮询
 * - 规范增补 v0.2 §3.1 三层可见模型（L1 雷达图+差值+待沟通+分歧；L2 纪念卡+共识区；L3 可勾选分享）
 * - docs/adr/ADR-005.md 决策 2（维度解读按差值等级分档）/ 决策 5（模板冻结范围）
 */

import type { ReportLevel } from './entities/report-template.entity.js';

/** 报告状态（与 report.status 取值一致；D1） */
export const REPORT_STATUS = {
  PENDING: 'pending',
  READY: 'ready',
  FAILED: 'failed',
} as const;

/** 三层可见层级（R3） */
export const REPORT_LEVEL = {
  /** 完整版：发起方 */
  L1: 'L1',
  /** 基础版：被邀请方 */
  L2: 'L2',
  /** 分享版：发起方生成 */
  L3: 'L3',
} as const satisfies Record<string, ReportLevel>;

/**
 * 双人报告区块键（block_key）
 *
 * 维度解读块的 block_key 直接用**维度编码**（与单人简版一致，ADR-004 决策 3），
 * 同一维度按差值等级存在 high/mid/low 三行（gap_level 列区分，ADR-005 决策 2）。
 */
export const DOUBLE_BLOCK = {
  /** L1/L2 开场白 */
  INTRO: 'INTRO',
  /** L1 双人雷达图引导语 */
  RADAR: 'RADAR',
  /** L1 待沟通区（含明细清单） */
  PENDING: 'PENDING',
  /** L1 逐题分歧明细 */
  DIVERGENCE: 'DIVERGENCE',
  /** L1 未评估维度说明（ADR-005 决策 7：被跳过维度不参与比对，统一标注） */
  UNEVALUATED: 'UNEVALUATED',
  /** L1/L2 共识区（L2 的唯一实质内容来源） */
  CONSENSUS: 'CONSENSUS',
  /** L1/L2 底线题核实提示（R5，双向同一文案） */
  BASELINE_NOTICE: 'BASELINE_NOTICE',
  /** L1 作答质量统一提示（C10，不暴露是哪一方） */
  QUALITY_NOTICE: 'QUALITY_NOTICE',
  /** L1 沟通引导（D4：建议以探讨而非对质的方式开启对话） */
  TALK_GUIDE: 'TALK_GUIDE',
  /** L1 结尾总结 */
  ENDING: 'ENDING',
  /** L2 共同完成纪念卡 */
  MEMORY_CARD: 'MEMORY_CARD',
  /** L2「有些话想和你聊聊」入口 */
  TALK_ENTRY: 'TALK_ENTRY',
  /** L3 长图标题区 */
  SHARE_TITLE: 'SHARE_TITLE',
  /** L3 长图共识区 */
  SHARE_CONSENSUS: 'SHARE_CONSENSUS',
  /** L3 长图结尾（正向引导） */
  SHARE_ENDING: 'SHARE_ENDING',
} as const;

/**
 * L3 分享版**禁止出现**的占位符（白名单裁剪的反向表述，ADR-005 决策 4）
 *
 * 为什么用「禁用键」而不是「允许键」：L3 模板里还有昵称/日期/共识清单等大量安全键，
 * 列允许键容易漏（漏一个就静默丢内容）；禁用键是有限闭集（分数/差值/分歧/档位），
 * 只要命中即视为模板越权 → **丢弃该区块并告警**（fail-closed，绝不把分数画进长图）。
 */
export const SHARE_FORBIDDEN_PLACEHOLDERS: readonly string[] = [
  '分数A',
  '分数B',
  '差值',
  '档位',
  '维度名',
  '待沟通清单',
  '分歧清单',
  '未评估清单',
  '底线提示',
  '质量提示',
];

/**
 * 报告模板占位符名（渲染上下文键）
 *
 * 集中登记的理由与其它常量一致：模板文案与渲染代码分处两地，
 * 键名一旦拼错会静默留下 `{分数B}` 原样文本（渲染引擎非严格模式不抛错），
 * 只有共享常量才能让这个错误在编译期暴露。
 */
export const REPORT_PLACEHOLDER = {
  NICKNAME_A: '昵称A',
  NICKNAME_B: '昵称B',
  SCALE_VERSION: '量表版本',
  DIMENSION_NAME: '维度名',
  SCORE_A: '分数A',
  SCORE_B: '分数B',
  GAP: '差值',
  GAP_LABEL: '档位',
  PENDING_LIST: '待沟通清单',
  DIVERGENCE_LIST: '分歧清单',
  UNEVALUATED_LIST: '未评估清单',
  CONSENSUS_LIST: '共识清单',
  BASELINE_NOTICE: '底线提示',
  QUALITY_NOTICE: '质量提示',
  DATE: '日期',
} as const;

/**
 * 报告渲染缓存 TTL（秒）
 * 依据 architecture.md §3.2：报告渲染结果缓存 300 秒（改模板后最迟 5 分钟生效）
 * ⚠️ 不缓存 L3：其内容随发起方每次勾选变化，缓存会串味
 */
export const REPORT_VIEW_CACHE_TTL_SEC = 300;

/** 渲染缓存的键前缀（不含 RedisService 的统一 keyPrefix `zhiban:`） */
export const REPORT_VIEW_CACHE_PREFIX = 'report:double:';
