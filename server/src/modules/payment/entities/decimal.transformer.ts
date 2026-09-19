import type { ValueTransformer } from 'typeorm';

/**
 * DECIMAL 列 ↔ number 转换器
 *
 * MySQL 的 DECIMAL 经 mysql2 取出是**字符串**（避免精度丢失），
 * 但本项目金额上限 = 单价 ¥19.9，远小于 Number.MAX_SAFE_INTEGER，
 * 转成 number 后仍可安全比较与做分/元换算；不转则会出现
 * `'8.00' === 8` 为 false 这类隐蔽 bug（E4 金额校验处最危险）。
 */
export const decimalTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | number | null) => (value === null ? 0 : Number(value)),
};
