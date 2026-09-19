import { API_VERSION_PREFIX } from '../config/env';
import type {
  CreateOrderResult,
  EntitlementSummary,
  OrderDetailView,
  ProductView,
  RedeemCouponResult,
} from '../types/payment';
import { get, post } from '../utils/request';

/** 商品 / 权益接口基路径（契约见 docs/api.md §14） */
const BASE = API_VERSION_PREFIX;

/** 订单接口基路径 */
const ORDER_BASE = `${API_VERSION_PREFIX}/orders`;

/**
 * 支付与权益接口（模块 6）
 *
 * 约定：
 * - 全部需要登录态：权益挂在 user 上，不存在「未登录也能拿到解锁态」的旁路
 * - **金额一律由服务端决定**：下单只传 productCode，请求体不接收金额（E4）
 * - 解锁态一律以 `entitlements()` 的返回为准，本地缓存只作首屏占位
 * - 局部更新用 PUT 而非 PATCH（wx.request 的 method 合法值不含 PATCH）
 *
 * P1 说明（宪法 §2.5 全免费）：下单走「免费直发」，`createOrder` 返回
 * `settled = true`，端上无需调起支付，直接刷新权益即可。
 */
export const paymentApi = {
  /** 在售商品列表（定价页；`iosVisible` 由端上按平台判断是否展示购买入口） */
  products(): Promise<ProductView[]> {
    return get<ProductView[]>(`${BASE}/products`);
  },

  /** 我的权益汇总（端上渲染解锁态的唯一依据，每次进入相关页面都重新拉取） */
  entitlements(): Promise<EntitlementSummary> {
    return get<EntitlementSummary>(`${BASE}/entitlements`);
  },

  /**
   * 下单（幂等：同商品存在未完成订单时服务端复用）
   * 返回 `settled = true` 时无需支付动作，直接重新拉取权益解锁。
   */
  createOrder(productCode: string): Promise<CreateOrderResult> {
    return post<CreateOrderResult, { productCode: string }>(ORDER_BASE, { productCode });
  },

  /** 我的订单（按时间倒序；P1 金额恒为 0，仍作为「我解锁了什么」的凭据） */
  myOrders(): Promise<OrderDetailView[]> {
    return get<OrderDetailView[]>(`${ORDER_BASE}/mine`);
  },

  /** 单笔订单详情（纯读，不触发查单；支付后轮询用） */
  orderDetail(outTradeNo: string): Promise<OrderDetailView> {
    return get<OrderDetailView>(`${ORDER_BASE}/${outTradeNo}`);
  },

  /**
   * 恢复购买（E1 漏单兜底）：服务端拿最近一笔未完成订单去网关查单
   * @returns 无未完成订单时返回 null
   */
  restorePurchase(): Promise<OrderDetailView | null> {
    return post<OrderDetailView | null>(`${ORDER_BASE}/restore-purchase`);
  },

  /**
   * 兑换码核销（PRD-005 §4 iOS 过渡期由客服会话发放；一次性 + 7 天有效）
   * 失败码：60008 无效 / 60009 已使用 / 60010 已过期
   */
  redeemCoupon(code: string): Promise<RedeemCouponResult> {
    return post<RedeemCouponResult, { code: string }>(`${BASE}/coupons/redeem`, { code });
  },
};
