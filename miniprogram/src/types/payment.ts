/**
 * 支付与权益域类型（模块 6）
 * 与服务端对应文件保持一致（改动需同步两端）：
 *   - server/src/modules/payment/payment.types.ts
 *   - server/src/modules/payment/payment.constants.ts
 * 接口契约见 docs/api.md §14
 */

/** 商品权益载荷类型（product.benefits 的 type 字段） */
export const BENEFIT_TYPE_DOUBLE_REPORT = 'double_report';
export const BENEFIT_TYPE_TOPIC = 'topic';
export const BENEFIT_TYPE_TOPIC_BUNDLE = 'topic_bundle';

/** 商品编码（服务端 payment.constants.ts 的同名字段） */
export const PRODUCT_DOUBLE_INVITE = 'double_invite';
export const PRODUCT_TOPIC_BUNDLE = 'topic_bundle';
/** 单议题商品编码前缀：`topic_single:<topicCode>` */
export const PRODUCT_TOPIC_SINGLE_PREFIX = 'topic_single:';

/** 权益来源：order 下单 / coupon 兑换码 / manual 后台补发 */
export type EntitlementSource = 'order' | 'coupon' | 'manual';

export type ProductBenefit =
  | { type: typeof BENEFIT_TYPE_DOUBLE_REPORT }
  | { type: typeof BENEFIT_TYPE_TOPIC; topicCode: string }
  | { type: typeof BENEFIT_TYPE_TOPIC_BUNDLE; topicCodes: string[] };

/** 端上商品视图（GET /v1/products） */
export interface ProductView {
  code: string;
  name: string;
  /** 单位：元；**始终以服务端为准**，端上不得自行计算金额 */
  price: number;
  /** iOS 端是否展示购买入口（PRD-005 §4：iOS 隐藏虚拟商品购买） */
  iosVisible: boolean;
  benefits: ProductBenefit[];
}

/** 端上权益项 */
export interface EntitlementView {
  id: number;
  productCode: string;
  source: EntitlementSource;
  grantedAt: string;
  expireAt: string | null;
  benefits: ProductBenefit[];
}

/**
 * 权益汇总（GET /v1/entitlements）——端上渲染解锁态的**唯一依据**
 *
 * ⚠️ PRD-005 §1：任何「已解锁」判断都必须来自本接口，
 *    本地缓存只能用于首屏占位，进入页面必须重新拉取。
 */
export interface EntitlementSummary {
  /** 是否已解锁双人对比报告完整版 */
  doubleReport: boolean;
  /** 已解锁的议题编码（含「全包」展开后的结果） */
  topics: string[];
  /** 是否持有议题全包 */
  topicBundle: boolean;
  items: EntitlementView[];
}

/** 调起微信支付的参数（字段名与 wx.requestPayment 一致，端上直接展开传入） */
export interface PaymentLaunchParams {
  channel: 'wechat' | 'mock';
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

/** 下单结果（POST /v1/orders） */
export interface CreateOrderResult {
  orderId: number;
  outTradeNo: string;
  /** 单位：元 */
  amount: number;
  status: string;
  /** true = 无需支付动作（P1 免费模式下单即到账），端上直接刷新权益 */
  settled: boolean;
  /** settled = false 时非空 */
  launchParams: PaymentLaunchParams | null;
}

/** 订单状态：created 已创建 / paying 支付中 / paid 已支付 / closed 已关闭 / refunding 退款中 / refunded 已退款 */
export type OrderStatus =
  | 'created'
  | 'paying'
  | 'paid'
  | 'closed'
  | 'refunding'
  | 'refunded';

/** 单笔订单详情（GET /v1/orders/:outTradeNo） */
export interface OrderDetailView {
  orderId: number;
  outTradeNo: string;
  productCode: string;
  productName: string;
  amount: number;
  status: OrderStatus;
  paidAt: string | null;
  expireAt: string | null;
  /** 是否在本轮查单中把订单推进到已支付（E1） */
  recovered: boolean;
}

/** 兑换码核销结果（POST /v1/coupons/redeem） */
export interface RedeemCouponResult {
  productCode: string;
  benefits: ProductBenefit[];
  grantedAt: string;
}
