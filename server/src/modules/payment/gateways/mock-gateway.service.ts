import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { PaymentConfig } from '../../../config/configuration.js';
import type {
  NotifyParseInput,
  NotifyParseResult,
  PrepayResult,
  QueryOrderResult,
  RefundResult,
} from '../payment.types.js';
import {
  MOCK_SIGN_HEADER_NONCE,
  MOCK_SIGN_HEADER_SIGNATURE,
  MOCK_SIGN_HEADER_TIMESTAMP,
  verifyMockNotify,
} from './mock-signature.util.js';
import type { PaymentGateway, PrepayInput, RefundInput } from './payment-gateway.interface.js';

/** 随机串长度（与微信支付一致） */
const NONCE_LENGTH = 16;

/** mock 演练用的回调报文载荷（与微信支付 V3 的 resource 解密后结构保持字段名一致） */
export interface MockNotifyPayload {
  out_trade_no: string;
  transaction_id: string;
  /** 分 */
  amount_total: number;
  trade_state: string;
  success_time?: string | null;
}

/**
 * 模拟支付网关（PAYMENT_GATEWAY=mock，仅本地/联调）
 *
 * 存在意义：模块 6 的完成标准要求验证「伪造回调被拒」与「重复回调幂等」，
 *   而 P1 没有商户号也拿不到微信沙箱。本网关把这两条链路的**代码路径**完整保留：
 *   - 验签走 HmacSHA256 + 时间戳窗口（防重放）
 *   - 回调处理复用 PaymentService.handleNotify（同一套落库 + 幂等 + 入账）
 *
 * 安全：生产启用本网关会被 env.validation 直接拒绝启动（等价于开放「白拿权益」后门）。
 */
@Injectable()
export class MockGatewayService implements PaymentGateway {
  readonly kind = 'mock' as const;

  /** mock 没有独立账单源，查单结果不代表真实入账 */
  readonly supportsQuery = false;

  private readonly signKey: string;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    const config = configService.get<PaymentConfig>('payment') as PaymentConfig;
    this.signKey = config.mockSignKey;
    // 仅在实际启用 mock 时告警：本类会被 PaymentModule 无条件实例化（供网关工厂挑选），
    // 否则 P1 的 free 环境日志里会一直躺着一句没有意义的「禁止在生产启用」。
    if (config.gateway === 'mock') {
      this.logger.warn(
        '支付网关为 mock（模拟支付）：仅可用于联调演练，禁止在生产启用',
        'MockGateway',
      );
    }
  }

  prepay(input: PrepayInput): Promise<PrepayResult> {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(NONCE_LENGTH).toString('hex');
    const packageValue = `prepay_id=mock_${input.outTradeNo}`;

    // 与微信 JSAPI 支付参数同构，端上按 channel 决定「是否真的调起 wx.requestPayment」
    return Promise.resolve({
      launchParams: {
        channel: 'mock',
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: 'MOCK',
        paySign: this.signLaunchParams(timeStamp, nonceStr, packageValue),
      },
      prepayId: packageValue,
      settled: false,
    });
  }

  async parseNotify(input: NotifyParseInput): Promise<NotifyParseResult> {
    const timestamp = input.headers[MOCK_SIGN_HEADER_TIMESTAMP];
    const nonce = input.headers[MOCK_SIGN_HEADER_NONCE];
    const signature = input.headers[MOCK_SIGN_HEADER_SIGNATURE];

    if (!timestamp || !nonce || !signature) {
      return { verified: false, reason: '缺少签名头（wechatpay-timestamp / nonce / signature）' };
    }

    const result = verifyMockNotify(
      { timestamp, nonce, rawBody: input.rawBody, signature, signKey: this.signKey },
      Math.floor(Date.now() / 1000),
    );
    if (!result.ok) {
      return { verified: false, reason: result.reason ?? '验签失败' };
    }

    let payload: MockNotifyPayload;
    try {
      payload = JSON.parse(input.rawBody) as MockNotifyPayload;
    } catch {
      return { verified: false, reason: '回调报文不是合法 JSON' };
    }

    if (!payload.out_trade_no || typeof payload.amount_total !== 'number') {
      return { verified: false, reason: '回调报文缺少 out_trade_no 或 amount_total' };
    }

    return {
      verified: true,
      payment: {
        outTradeNo: payload.out_trade_no,
        transactionId: payload.transaction_id || `mock-${payload.out_trade_no}`,
        amountTotal: payload.amount_total,
        tradeState: payload.trade_state || 'SUCCESS',
        successTime: payload.success_time ?? null,
      },
    };
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
      `模拟退款：outTradeNo=${input.outTradeNo} 金额=${input.amountFen}分 原因=${input.reason}`,
      'MockGateway',
    );
    return Promise.resolve({ refundId: `mock-refund-${input.outTradeNo}`, status: 'SUCCESS' });
  }

  /** 端上支付参数签名（仅用于展示，端上不会真正调起微信支付） */
  private signLaunchParams(timeStamp: string, nonceStr: string, packageValue: string): string {
    return Buffer.from(`${timeStamp}|${nonceStr}|${packageValue}`).toString('base64url');
  }
}
