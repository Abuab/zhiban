import type { PaymentGatewayKind } from '../../../config/configuration.js';
import type {
  NotifyParseInput,
  NotifyParseResult,
  PrepayResult,
  QueryOrderResult,
  RefundResult,
} from '../payment.types.js';

/**
 * 支付网关依赖注入令牌（ADR-007 决策 1）
 * 由 PaymentModule 按 `PAYMENT_GATEWAY` 配置选择具体实现；
 * 业务代码只依赖本接口，**不得**直接依赖任一实现类。
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** 预下单入参 */
export interface PrepayInput {
  outTradeNo: string;
  /** 金额（分）。微信支付最小单位为分，故内部一律用分做网关侧口径 */
  amountFen: number;
  /** 商品描述（微信账单展示，最长 127 字符） */
  description: string;
  /** JSAPI 支付必需的 openid（本产品小程序内支付，openid 必填） */
  openid: string;
}

/** 退款入参 */
export interface RefundInput {
  outTradeNo: string;
  amountFen: number;
  reason: string;
}

/**
 * 支付网关抽象
 *
 * 存在意义（ADR-007 决策 1）：宪法 §2.5 定「P1 全免费」，但模块 6 的完成标准要求
 * 验证「伪造回调被拒」「重复回调幂等」——只有把网关抽象出来、把 free/mock/wechat
 * 三个实现挂到同一套回调处理代码上，才能在不持有商户号的前提下验证真实链路。
 *
 * 契约：
 *   - 实现方**不得**自行重试、不得吞掉异常（漏单由对账 + 恢复购买兜底，E1）
 *   - `parseNotify` 验签失败**不得抛异常**，必须返回 `{ verified: false, reason }`，
 *     否则调用方无法把失败报文落 `payment_notify_log` 留证
 */
export interface PaymentGateway {
  readonly kind: PaymentGatewayKind;

  /** 预下单：返回端上支付参数；`settled = true` 表示无需支付动作（免费模式） */
  prepay(input: PrepayInput): Promise<PrepayResult>;

  /** 解析支付回调（验签 + 解密），失败必须返回结构而不是抛错 */
  parseNotify(input: NotifyParseInput): Promise<NotifyParseResult>;

  /** 查单（E1 恢复购买 / 每日对账） */
  queryOrder(outTradeNo: string): Promise<QueryOrderResult>;

  /** 退款（E7 未生成报告可退 / E10 退款收回权益） */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * 是否支持主动查单
   * free / mock 无外部账单可查（对账任务据此跳过而不是伪造「无差异」）
   */
  readonly supportsQuery: boolean;
}
