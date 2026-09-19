import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type {
  NotifyParseInput,
  NotifyParseResult,
  PrepayResult,
  QueryOrderResult,
  RefundResult,
} from '../payment.types.js';
import type { PaymentGateway, PrepayInput, RefundInput } from './payment-gateway.interface.js';

/**
 * 免费模式网关（P1 默认实现，PAYMENT_GATEWAY=free）
 *
 * 规格依据：宪法 §2.5「P1 阶段：全免费，不接支付」
 *
 * 行为：下单即视为到账 —— 调用方（OrderService）拿到 `settled = true` 后
 *   直接在同一事务内把订单置为已支付并发放权益，**不产生任何外部网络调用**。
 * 为什么仍保留「订单」这个中间态：P2 恢复付费时只换网关配置，
 *   订单/权益/幂等链条无需改动（ADR-007 决策 1）。
 *
 * 安全：本实现**不接受任何支付回调**（verified 恒为 false），
 *   因此即使有人向 /api/v1/pay/notify 打伪造报文，也不可能凭它拿到权益。
 */
@Injectable()
export class FreeGatewayService implements PaymentGateway {
  readonly kind = 'free' as const;

  /** 免费模式没有外部账单可查 */
  readonly supportsQuery = false;

  constructor(private readonly logger: AppLogger) {}

  prepay(input: PrepayInput): Promise<PrepayResult> {
    this.logger.log(
      `免费模式（P1）下单直接到账：outTradeNo=${input.outTradeNo} 金额=${input.amountFen}分`,
      'FreeGateway',
    );
    return Promise.resolve({ launchParams: null, prepayId: null, settled: true });
  }

  parseNotify(_input: NotifyParseInput): Promise<NotifyParseResult> {
    return Promise.resolve({
      verified: false,
      reason: '当前为免费模式（PAYMENT_GATEWAY=free），本网关不接受支付回调',
    });
  }

  queryOrder(outTradeNo: string): Promise<QueryOrderResult> {
    return Promise.resolve({
      outTradeNo,
      tradeState: 'NOT_SUPPORTED',
      amountTotal: 0,
      transactionId: null,
      successTime: null,
    });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    this.logger.log(
      `免费模式退款为记账语义（无真实资金流）：outTradeNo=${input.outTradeNo} 原因=${input.reason}`,
      'FreeGateway',
    );
    return Promise.resolve({ refundId: `free-${input.outTradeNo}`, status: 'SUCCESS' });
  }
}
