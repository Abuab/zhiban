/**
 * 展示格式化工具（客户端本地时区）
 * 说明：时间在接口里一律是 ISO 8601 字符串，端上只做展示格式化，不做任何业务判定。
 */

/** 日期：`YYYY-MM-DD`；非法或缺失返回占位符 */
export function formatDate(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
