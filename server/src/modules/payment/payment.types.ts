import type {
  BENEFIT_TYPE_DOUBLE_REPORT,
  BENEFIT_TYPE_TOPIC,
  BENEFIT_TYPE_TOPIC_BUNDLE,
  EntitlementSource,
} from './payment.constants.js';

/**
 * 商品权益载荷（product.benefits_json）
 * 形如 `{ "type": "topic", "topicCode": "money" }`；全包用 `topicCodes` 列出全部议题
 */
export type ProductBenefit =
  | { type: typeof BENEFIT_TYPE_DOUBLE_REPORT }
  | { type: typeof BENEFIT_TYPE_TOPIC; topicCode: string }
  | { type: typeof BENEFIT_TYPE_TOPIC_BUNDLE; topicCodes: string[] };

/** 端上商品视图（GET /api/v1/products，免鉴权但需登录以判定 iOS 可见性） */
export interface ProductView {
  code: string;
  name: string;
  /** 单位：元（后端唯一可信金额，E4） */
  price: number;
  /** iOS 端是否展示购买入口（PRD-005 §4：iOS 隐藏虚拟商品购买） */
  iosVisible: boolean;
  benefits: ProductBenefit[];
}

/** 端上权益项（GET /api/v1/entitlements） */
export interface EntitlementView {
  id: number;
  productCode: string;
  source: EntitlementSource;
  grantedAt: string;
  expireAt: string | null;
  benefits: ProductBenefit[];
}

/**
 * 权益汇总（端上据此渲染解锁态）
 *
 * ⚠️ PRD-005 §1：前端任何「已解锁」判断都必须来自服务端本接口，
 *    禁止把上次结果当判定依据（本地缓存仅供渲染占位，进入页面须重新拉取）
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

/** 端上支付调起参数（与 wx.requestPayment 的字段同名，端上直接展开传入） */
export interface PaymentLaunchParams {
  /** wechat = 调起微信支付；mock = 端上展示「模拟支付完成」入口（仅演练环境出现） */
  channel: 'wechat' | 'mock';
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

/** 下单结果（POST /api/v1/orders） */
export interface CreateOrderResult {
  orderId: number;
  outTradeNo: string;
  /** 元；**始终以后端商品表为准，请求体中的金额字段不被采信**（E4） */
  amount: number;
  status: string;
  /** true = 无需支付动作（免费模式或复用已付订单），端上直接刷新权益 */
  settled: boolean;
  /** settled = false 时非空 */
  launchParams: PaymentLaunchParams | null;
}

/** 单笔订单详情（GET /api/v1/orders/:outTradeNo，供「恢复购买」查单） */
export interface OrderDetailView {
  orderId: number;
  outTradeNo: string;
  productCode: string;
  productName: string;
  amount: number;
  status: string;
  paidAt: string | null;
  expireAt: string | null;
  /** 查单补单是否在本轮把订单推进到已支付（E1） */
  recovered: boolean;
}

/** 兑换结果（POST /api/v1/coupons/redeem） */
export interface RedeemCouponResult {
  productCode: string;
  benefits: ProductBenefit[];
  grantedAt: string;
}

/** 网关预下单结果 */
export interface PrepayResult {
  /** 端上支付参数；已到账（免费模式）时为 null */
  launchParams: PaymentLaunchParams | null;
  /** 网关侧预支付标识，落 order.prepay_id */
  prepayId: string | null;
  /** true = 无需用户支付动作，订单可直接置为已支付 */
  settled: boolean;
}

/** 网关回调解析输入 */
export interface NotifyParseInput {
  /** HTTP 头（微信支付 V3 的签名头在此；mock 用同名头以便共用解析分支） */
  headers: Record<string, string | undefined>;
  /** 原始报文（验签必须用原始字节，不能是已解析对象） */
  rawBody: string;
}

/** 网关回调解析结果（验签失败也必须返回结构，供 payment_notify_log 留证） */
export interface NotifyParseResult {
  /** 验签 + 解密是否通过 */
  verified: boolean;
  /** 支付结果（verified = true 时必有） */
  payment?: {
    outTradeNo: string;
    transactionId: string;
    /** 分（网关口径）；与本地订单比对时再换算，避免浮点误差 */
    amountTotal: number;
    /** SUCCESS / REFUND 等网关交易状态 */
    tradeState: string;
    successTime: string | null;
  };
  /** 失败原因（落日志，不回给调用方以外的第三方） */
  reason?: string;
}

/** 网关查单结果（E1 恢复购买 / 每日对账） */
export interface QueryOrderResult {
  outTradeNo: string;
  /** SUCCESS / NOTPAY / CLOSED / REFUND 等 */
  tradeState: string;
  /** 分 */
  amountTotal: number;
  transactionId: string | null;
  successTime: string | null;
}

/** 退款结果 */
export interface RefundResult {
  /** 网关侧退款单号 */
  refundId: string;
  /** SUCCESS / PROCESSING */
  status: string;
}
