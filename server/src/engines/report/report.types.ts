/**
 * L1 领域引擎层 · 报告模板领域类型
 *
 * 本文件只描述**纯数据结构**，禁止 import 数据库/HTTP 相关模块。
 * 依据 docs/architecture.md §2「依赖规则（硬约束）」第 1 条：
 *   L1 引擎层禁止依赖数据库/HTTP，只接受纯数据结构入参
 * 依据 docs/architecture.md「报告域：渲染时读取；改文案零发版」：
 *   模板文本由调用方从 report_template_block 读出后传入，引擎不碰库。
 *
 * 规格依据：
 * - docs/schema.sql `report_template_block`（block_key / order_no / min_chars / template_text）
 * - docs/api.md §0：昵称按 Unicode 码点计数（emoji 记 1 个字符）
 */

/** 模板区块（对应 report_template_block 表，由调用方从库读出后传入，引擎不碰库） */
export interface TemplateBlock {
  blockKey: string;
  orderNo: number;
  /** 占位符文本，如「你和{昵称B}在{维度名}上的分差是{差值}分」 */
  templateText: string;
  /** 内容详实度下限（report_template_block.min_chars），渲染后可校验 */
  minChars?: number | null;
}

/** 渲染上下文：占位符名 → 值（undefined / null 视为缺失） */
export type RenderContext = Record<string, string | number>;

/** 单个区块的渲染结果 */
export interface RenderedBlock {
  blockKey: string;
  orderNo: number;
  /** 渲染后的文本 */
  text: string;
  /** 是否达到 minChars 下限（未设置下限时为 true） */
  meetsMinChars: boolean;
  /** 渲染后缺失的占位符名（用于运营排查，正常应为空数组） */
  missingKeys: string[];
}
