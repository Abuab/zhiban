/**
 * 权益与订单域前端常量（模块 6）
 *
 * 原则（同 constants/topic.ts）：只放**结构性常量与规格已固定的文案**；
 *   随运营变化的文案一律由服务端下发 —— 商品名、价格、权益载荷、订单金额与状态都来自接口，
 *   端上不承载运营文案（宪法 P5）。
 *
 * 规格依据：PRD-005 §1（解锁判定只读服务端）/ §4（iOS 策略）/ §5（退款与客诉）、
 *   边界总表 E1（恢复购买）/ E3（超时关闭）/ E8（兑换码）、docs/adr/ADR-009.md
 */

/** 权益域页面路径（集中登记：pages.json 必须与之一字不差） */
export const ENTITLEMENT_PAGE_PATH = '/pages/entitlement/entitlement';

/**
 * 权益来源展示名（`entitlement.source` 的三个取值）
 *
 * 用途：让用户分得清「这条路是怎么来的」—— 尤其是客服代发（`manual`）与兑换码（`coupon`），
 *   出问题时可据此回溯是后台补发还是码池发放。
 */
export const ENTITLEMENT_SOURCE_LABELS: Record<string, string> = {
  order: '购买解锁',
  coupon: '兑换码',
  manual: '客服发放',
};

/** 服务端新增来源而端上未同步时的兜底文案（不显示英文枚举） */
export const ENTITLEMENT_SOURCE_FALLBACK_LABEL = '已解锁';

/** 订单状态展示名（与服务端 payment.constants.ts 的六态同源） */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  created: '待支付',
  paying: '待支付',
  paid: '已到账',
  closed: '已关闭',
  refunding: '退款中',
  refunded: '已退款',
};

/** 服务端新增状态而端上未同步时的兜底文案 */
export const ORDER_STATUS_FALLBACK_LABEL = '处理中';

/**
 * 权益载荷的说明文案（按 `benefits[].type` 渲染「买它得到什么」）
 *
 * 为什么端上写死这几句：它们是**权益类型**的中文名（`double_report` / `topic` / `topic_bundle`），
 *   与具体商品名无关，不随运营变化；运营改的永远是商品名与价格。
 */
export const BENEFIT_DESCRIPTIONS: Record<string, string> = {
  double_report: '解锁双人对比报告完整版',
  topic: '解锁该议题的 AI 专属建议',
  topic_bundle: '一次解锁全部议题的 AI 专属建议',
};

/** 服务端新增权益类型而端上未同步时的兜底说明 */
export const BENEFIT_FALLBACK_DESCRIPTION = '解锁对应的专属内容';

/** 已持有该权益时的角标 */
export const OWNED_BADGE = '已解锁';

/**
 * iOS 端隐藏购买入口时的引导文案（PRD-005 §4）
 *
 * 仅在「需要真实支付（price > 0）且商品未开放 iOS 展示」时出现；
 * P1 全免费不涉及支付，故 iOS 同样展示「领取」（ADR-009 决策 1）。
 */
export const IOS_PURCHASE_BLOCKED_HINT = 'iOS 端暂不支持在线购买，请在下方输入客服发放的兑换码';

/** 恢复购买（E1 漏单兜底）的操作说明 */
export const RESTORE_HINT = '付过款但权益没到账？点一下这里找回';
