/**
 * 支付与权益域常量（模块 6，ADR-007）
 *
 * 规格依据：
 * - PRD-005 §1 权益模型（entitlement 挂在 user 上，服务端唯一可信）
 * - PRD-005 §2 入账流程（金额以后端商品表为准；回调幂等；失败不丢单）
 * - 边界总表 E2（幂等键）/ E3（30 分钟保留）/ E6（商品快照）/ E8（兑换码 7 天）/ E9（预下单幂等）
 */

/** 商品编码：双人对比报告解锁（¥8） */
export const PRODUCT_DOUBLE_INVITE = 'double_invite';

/** 商品编码：议题全包（定价 v0.2：¥19.90） */
export const PRODUCT_TOPIC_BUNDLE = 'topic_bundle';

/**
 * 单议题商品编码前缀：`topic_single:<topicCode>`
 *
 * 为什么每议题一行商品，而不是一个 `topic_single` 商品 + 一张映射表（ADR-007 附带决策 7）：
 *   `entitlement` 表只有 `product_id`，没有 `topic_id`；把「买了哪个议题」编码进商品本身，
 *   既能让权益查询一次取全，又**不需要 ALTER 表**（schema.sql 已冻结 31 张表）。
 */
export const PRODUCT_TOPIC_SINGLE_PREFIX = 'topic_single:';

/** product.status */
export const PRODUCT_STATUS_ON = 'on';
export const PRODUCT_STATUS_OFF = 'off';

/** order.status（schema.sql 注释：created / paying / paid / closed / refunding / refunded） */
export const ORDER_STATUS_CREATED = 'created';
export const ORDER_STATUS_PAYING = 'paying';
export const ORDER_STATUS_PAID = 'paid';
export const ORDER_STATUS_CLOSED = 'closed';
export const ORDER_STATUS_REFUNDING = 'refunding';
export const ORDER_STATUS_REFUNDED = 'refunded';

/** 未终结状态（可被超时关闭；E9 的「存在未完成订单则复用」也看这两个） */
export const ORDER_OPEN_STATUSES = [ORDER_STATUS_CREATED, ORDER_STATUS_PAYING];

/** entitlement.source（E8：码池发放 = coupon） */
export const ENTITLEMENT_SOURCE_ORDER = 'order';
export const ENTITLEMENT_SOURCE_COUPON = 'coupon';
export const ENTITLEMENT_SOURCE_MANUAL = 'manual';
export const ENTITLEMENT_SOURCE_CODES = [
  ENTITLEMENT_SOURCE_ORDER,
  ENTITLEMENT_SOURCE_COUPON,
  ENTITLEMENT_SOURCE_MANUAL,
] as const;

export type EntitlementSource = (typeof ENTITLEMENT_SOURCE_CODES)[number];

/** entitlement.status（E10：退款回调 → 作废） */
export const ENTITLEMENT_STATUS_ACTIVE = 'active';
export const ENTITLEMENT_STATUS_REVOKED = 'revoked';

/** coupon.status */
export const COUPON_STATUS_UNUSED = 'unused';
export const COUPON_STATUS_USED = 'used';
export const COUPON_STATUS_EXPIRED = 'expired';

/**
 * 权益载荷类型（product.benefits_json.type）
 * 端上据此渲染「我拥有什么」，服务端据此判断议题是否可读
 */
export const BENEFIT_TYPE_DOUBLE_REPORT = 'double_report';
export const BENEFIT_TYPE_TOPIC = 'topic';
export const BENEFIT_TYPE_TOPIC_BUNDLE = 'topic_bundle';

/** 支付幂等/回调：微信侧成功应答体（必须是裸 JSON，不带统一响应体包装） */
export const WXPAY_SUCCESS_BODY = JSON.stringify({ code: 'SUCCESS', message: '成功' });
export const WXPAY_FAIL_BODY = JSON.stringify({ code: 'FAIL', message: '失败' });

/** 回调来源标识（payment_notify_log 无 channel 列，用 out_trade_no 前缀留证已足够；此处仅作日志用） */
export const NOTIFY_CHANNEL_WECHAT = 'wechat';
export const NOTIFY_CHANNEL_MOCK = 'mock';

/** 订单与对账的 BullMQ 队列（沿用 invite 域的「队列由使用方声明」约定） */
export const ORDER_EXPIRE_QUEUE = 'order-expire';
export const ORDER_EXPIRE_JOB_NAME = 'scan';
export const ORDER_EXPIRE_SCHEDULER_ID = 'order-expire-every-10min';
/** 每 10 分钟扫一次已过期未支付订单（E3：30 分钟保留期，10 分钟粒度足够且开销极低） */
export const ORDER_EXPIRE_PATTERN = '*/10 * * * *';
/** 台账业务键前缀（每轮一条，可追溯） */
export const ORDER_EXPIRE_BIZ_PREFIX = 'scan:';

export const PAY_CHECK_QUEUE = 'pay-check';
export const PAY_CHECK_JOB_NAME = 'daily';
export const PAY_CHECK_SCHEDULER_ID = 'pay-check-daily';
/** 每日 03:10 对账（避开 03:00 的报告/备份类任务，E1） */
export const PAY_CHECK_PATTERN = '10 3 * * *';
export const PAY_CHECK_BIZ_PREFIX = 'daily:';

/** job_task.type 取值（与 docs/schema.sql `job_task.type` 注释风格一致） */
export const JOB_TYPE_ORDER_EXPIRE = 'order_expire';
export const JOB_TYPE_PAY_CHECK = 'pay_check';

/** 订单号前缀（便于运维按前缀筛单；`out_trade_no` 长度上限 64） */
export const OUT_TRADE_NO_PREFIX = 'ZB';

/**
 * 下单占位键（E9：同用户同商品存在未完成订单则复用）
 * 值为 `pending`（正在建单）或 `out_trade_no`（已建单）；TTL = 订单保留期
 */
export const ORDER_REUSE_KEY_PREFIX = 'pay:order:';

/** 兑换码长度（去掉易混字符后由 crypto 生成，见 CouponService） */
export const COUPON_CODE_LENGTH = 12;

/** 兑换码字符集：去掉了 0/O/1/I 等易混字符（客服要在会话里念给用户听） */
export const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 权益缓存前缀（商品与权益都是低频读，只缓存商品表；权益一律直查库保证「付款即解锁」） */
export const PRODUCT_CACHE_PREFIX = 'pay:product:';
export const PRODUCT_CACHE_TTL_SEC = 300;

/** 对账单差异台账的 last_error 前缀（后台按此捞人工补单） */
export const PAY_CHECK_DIFF_PREFIX = '对账差异：';
