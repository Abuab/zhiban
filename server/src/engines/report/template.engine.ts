/**
 * L1 领域引擎层 · 报告模板引擎（占位符渲染）
 *
 * 纯函数实现，不 import 任何数据库 / HTTP / NestJS 模块。
 * 入参为调用方从 report_template_block 读出的纯数据结构（见 report.types.ts）。
 *
 * 规格依据：
 * - docs/schema.sql `report_template_block.template_text` 注释：{维度名} {分数} {昵称A} {昵称B} {差值}
 * - docs/architecture.md：报告域渲染时读取模板，改文案零发版
 * - docs/api.md §0：昵称按 Unicode 码点计数（emoji 记 1 个字符）
 */

import type { RenderContext, RenderedBlock, TemplateBlock } from './report.types.js';

/** 渲染选项 */
export interface RenderOptions {
  /**
   * 严格模式：遇到缺失占位符抛 Error（默认 false，缺失占位符原样保留）。
   * 供后台模板保存前的「未填参数」校验使用。
   */
  strict?: boolean;
}

/**
 * 占位符匹配：`{键}`，键由中英文、数字、下划线组成（如 {维度名} {昵称A} {score}）。
 *
 * 花括号内要求至少一个合法字符，因此**未闭合的 `{` 与空 `{}` 都不会匹配**，
 * 会原样保留在结果里、不抛错（运营可能正在编辑模板）。
 */
const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_\u4e00-\u9fff]+)\}/g;

/** 按 Unicode 码点计数（emoji 记 1 个字符，见 docs/api.md §0） */
function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * 渲染单段模板文本。
 *
 * 替换安全性说明：这里使用 `String.prototype.replace(regex, replacer)` 的**函数形式**，
 * 而非字符串替换模板。函数形式的返回值会被当作**字面量**整体写入结果，不会再把
 * `$&` / `$1` / `` $` `` / `$'` / `$$` 当作替换语法解释；因此即使上下文值里本身包含这些字符，
 * 渲染结果也完全原样（避免替换语法注入 / 值被吞掉）。
 *
 * @returns text 渲染结果；missingKeys 缺失占位符名（按首次出现顺序去重）
 */
export function renderTemplate(
  templateText: string,
  context: RenderContext,
  options: RenderOptions = {},
): { text: string; missingKeys: string[] } {
  const { strict = false } = options;
  const missingKeys = new Set<string>();

  const text = templateText.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) {
      if (strict) {
        throw new Error(`报告模板渲染失败：缺少占位符参数 {${key}}`);
      }
      // 非严格模式：缺失占位符原样保留，方便运营一眼看出模板少给了参数
      missingKeys.add(key);
      return match;
    }
    // 数字直接转字符串、字符串原样；不做 HTML 转义（后续由 P7 内容过滤器负责）
    return String(value);
  });

  return { text, missingKeys: [...missingKeys] };
}

/**
 * 按 orderNo 升序渲染全部区块。
 * orderNo 相同时保持输入顺序（Array.prototype.sort 自 ES2019 起稳定），保证结果确定性。
 * 不修改入参数组。
 */
export function renderBlocks(
  blocks: TemplateBlock[],
  context: RenderContext,
  options: RenderOptions = {},
): RenderedBlock[] {
  return [...blocks]
    .sort((a, b) => a.orderNo - b.orderNo)
    .map((block) => {
      const { text, missingKeys } = renderTemplate(block.templateText, context, options);
      const meetsMinChars =
        block.minChars === undefined || block.minChars === null
          ? true
          : countCodePoints(text) >= block.minChars;
      return {
        blockKey: block.blockKey,
        orderNo: block.orderNo,
        text,
        meetsMinChars,
        missingKeys,
      };
    });
}

/**
 * 提取模板中出现的全部占位符名，去重后按首次出现顺序返回。
 * 供后台模板编辑器做「未填参数」校验。
 */
export function collectPlaceholders(templateText: string): string[] {
  const seen = new Set<string>();
  for (const match of templateText.matchAll(PLACEHOLDER_PATTERN)) {
    seen.add(match[1]);
  }
  return [...seen];
}
