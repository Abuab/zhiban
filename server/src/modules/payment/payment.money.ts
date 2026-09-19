/**
 * 金额换算（模块 6）
 *
 * 为什么不直接 `amount * 100`：
 *   JS 浮点乘法会出现 `19.9 * 100 = 1989.9999999999998`，直接取整会少一分钱。
 *   统一用本文件换算，避免每处各写一遍取整方式。
 *
 * 口径约定（全项目唯一）：
 *   - 库内 `order.amount` / `product.price` 一律为**元**（DECIMAL(10,2)）
 *   - 网关（微信支付）一律为**分**（整数）
 *   - 两者之间只经本文件换算
 */

/** 元 → 分（四舍五入到分，消除浮点误差） */
export function yuanToFen(yuan: number): number {
  return Math.round((yuan + Number.EPSILON) * 100);
}

/** 分 → 元（保留两位小数，用于回写库或对外展示） */
export function fenToYuan(fen: number): number {
  return Number((fen / 100).toFixed(2));
}

/**
 * 兑换码到期时间（E8：7 天有效）
 *
 * 用「天数 × 24 小时」而不是 `setDate(+7)`：后者跨夏令时/月末会得到非整数天，
 * 而兑换码有效期是**运维承诺**（客服按 7×24 小时口头告知用户），必须可精确复算。
 */
export function calculateCouponExpireAt(days: number, from: Date): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
