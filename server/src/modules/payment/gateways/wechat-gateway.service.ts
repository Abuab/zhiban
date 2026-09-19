import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDecipheriv,
  createPrivateKey,
  createSign,
  createVerify,
  randomBytes,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { PaymentConfig, WechatConfig } from '../../../config/configuration.js';
import type {
  NotifyParseInput,
  NotifyParseResult,
  PaymentLaunchParams,
  PrepayResult,
  QueryOrderResult,
  RefundResult,
} from '../payment.types.js';
import type { PaymentGateway, PrepayInput, RefundInput } from './payment-gateway.interface.js';

/** 微信支付 APIv3 基址 */
const WXPAY_API_BASE = 'https://api.mch.weixin.qq.com';

/** 网络超时（毫秒）：支付链路必须有上限，否则回调处理会拖住 worker */
const REQUEST_TIMEOUT_MS = 8_000;

/** 回调时间戳容忍窗口（秒）：微信支付 V3 要求 5 分钟内 */
const NOTIFY_TIMESTAMP_TOLERANCE_SEC = 300;

/** 小程序 JSAPI 下单路径 */
const PATH_JSAPI = '/v3/pay/transactions/jsapi';

/**
 * 微信支付 V3 网关（PAYMENT_GATEWAY=wechat，P2 启用）
 *
 * 规格依据：PRD-005 §2 入账流程（预下单 → 支付 → 回调 → 验签 → 幂等 → 发权益）
 *
 * ⚠️ 本实现未接入真实商户号，**属未经实盘验证的代码路径**（ADR-007 决策 1）：
 *    - 已按官方 V3 文档实现签名串拼装、平台证书验签、AES-256-GCM 解密、金额比对；
 *    - 启用前必须在微信支付沙箱/小额实盘走一遍，并核对 `payment_notify_log` 的留证完整性。
 *
 * 安全设计（「恶意用户会怎么攻击这里」）：
 *   1. 回调必须验签（平台证书公钥 RSA-SHA256）→ 伪造报文在落库前即被识别为 verify_result = 0
 *   2. 验签通过后仍要**比对金额**与本地订单（防止拿别人的小额支付单号冲抵自己的大额订单）
 *   3. `wechatpay-serial` 必须与本地平台证书序列号一致，否则拒绝（平台证书轮换时 fail-closed，
 *      不会退化成「跳过验签」）
 *   4. 时间戳窗口 300 秒，超窗拒绝（防重放）
 */
@Injectable()
export class WechatGatewayService implements PaymentGateway, OnModuleInit {
  readonly kind = 'wechat' as const;

  readonly supportsQuery = true;

  private readonly config: PaymentConfig;

  private readonly appid: string;

  private privateKey: KeyObject | null = null;

  private platformCertSerial: string | null = null;

  private platformPublicKey: KeyObject | null = null;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.config = configService.get<PaymentConfig>('payment') as PaymentConfig;
    this.appid = (configService.get<WechatConfig>('wechat') as WechatConfig).appid;
  }

  /**
   * 启动即加载密钥材料（fail-fast）
   * 为什么不在首次支付时懒加载：路径写错/证书过期属于部署错误，
   *   等到用户点「立即解锁」才发现，代价是一笔真实交易失败。
   *
   * ⚠️ 仅在 `PAYMENT_GATEWAY=wechat` 时才加载：本类会被 PaymentModule 无条件实例化
   *   （供网关工厂按配置挑选），若在此不判断配置，则 free/mock 环境也会因
   *   「证书文件不存在」而启动失败 —— 那是把 P2 的部署要求强加给了 P1。
   */
  onModuleInit(): void {
    if (this.config.gateway !== 'wechat') return;

    try {
      this.privateKey = this.loadPrivateKey(this.config.wechatPay.privateKeyPath);
      const certificate = new X509Certificate(readFileSync(this.config.wechatPay.platformCertPath));
      this.platformPublicKey = certificate.publicKey;
      this.platformCertSerial = certificate.serialNumber.toUpperCase();
      this.logger.log(
        `微信支付 V3 网关已就绪：mchId=${this.config.wechatPay.mchId} 平台证书序列号=${this.platformCertSerial}`,
        'WechatGateway',
      );
    } catch (error) {
      // 抛出即阻断启动：选了 wechat 网关却读不到证书，不允许带病运行
      throw new Error(
        `微信支付证书加载失败（PAYMENT_GATEWAY=wechat 时必须可读）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async prepay(input: PrepayInput): Promise<PrepayResult> {
    const body = JSON.stringify({
      appid: this.appid,
      mchid: this.config.wechatPay.mchId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      notify_url: this.config.wechatPay.notifyUrl,
      amount: { total: input.amountFen, currency: 'CNY' },
      payer: { openid: input.openid },
    });

    const response = await this.request<{ prepay_id: string }>('POST', PATH_JSAPI, body);
    const prepayId = response.prepay_id;

    return {
      launchParams: this.buildLaunchParams(prepayId),
      prepayId,
      settled: false,
    };
  }

  async parseNotify(input: NotifyParseInput): Promise<NotifyParseResult> {
    const timestamp = input.headers['wechatpay-timestamp'];
    const nonce = input.headers['wechatpay-nonce'];
    const signature = input.headers['wechatpay-signature'];
    const serial = input.headers['wechatpay-serial'];

    if (!timestamp || !nonce || !signature || !serial) {
      return { verified: false, reason: '缺少微信支付签名头' };
    }
    if (!this.platformPublicKey || !this.platformCertSerial) {
      return { verified: false, reason: '平台证书未加载' };
    }
    if (serial.toUpperCase() !== this.platformCertSerial) {
      // 平台证书轮换后本地未更新 → fail-closed，绝不退化为「跳过验签」
      return {
        verified: false,
        reason: `平台证书序列号不匹配（收到 ${serial}，本地 ${this.platformCertSerial}），请更新证书`,
      };
    }

    const timestampSec = Number.parseInt(timestamp, 10);
    if (
      !Number.isFinite(timestampSec) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSec) > NOTIFY_TIMESTAMP_TOLERANCE_SEC
    ) {
      return { verified: false, reason: '回调时间戳超出容忍窗口（防重放）' };
    }

    const message = `${timestamp}\n${nonce}\n${input.rawBody}\n`;
    const verified = createVerify('RSA-SHA256')
      .update(message)
      .verify(this.platformPublicKey, signature, 'base64');
    if (!verified) {
      return { verified: false, reason: '回调验签失败' };
    }

    const envelope = this.parseJson<{
      event_type?: string;
      resource?: { ciphertext: string; nonce: string; associated_data?: string };
    }>(input.rawBody);
    if (!envelope?.resource?.ciphertext) {
      return { verified: false, reason: '回调报文缺少 resource 字段' };
    }

    const plaintext = this.decryptResource(envelope.resource);
    const payload = this.parseJson<{
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      success_time?: string;
      amount?: { total?: number };
    }>(plaintext);

    if (!payload?.out_trade_no || typeof payload.amount?.total !== 'number') {
      return { verified: false, reason: '解密后报文缺少 out_trade_no 或 amount.total' };
    }

    return {
      verified: true,
      payment: {
        outTradeNo: payload.out_trade_no,
        transactionId: payload.transaction_id ?? '',
        amountTotal: payload.amount.total,
        tradeState: payload.trade_state ?? '',
        successTime: payload.success_time ?? null,
      },
    };
  }

  async queryOrder(outTradeNo: string): Promise<QueryOrderResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.config.wechatPay.mchId)}`;
    const response = await this.request<{
      trade_state?: string;
      transaction_id?: string;
      success_time?: string;
      amount?: { total?: number };
    }>('GET', path, '');

    return {
      outTradeNo,
      tradeState: response.trade_state ?? 'UNKNOWN',
      amountTotal: response.amount?.total ?? 0,
      transactionId: response.transaction_id ?? null,
      successTime: response.success_time ?? null,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // out_refund_no 需在同商户下唯一：订单号本身已唯一，加前缀即可且不超 64 字符
    const outRefundNo = `RF${input.outTradeNo}`.slice(0, 64);
    const body = JSON.stringify({
      out_trade_no: input.outTradeNo,
      out_refund_no: outRefundNo,
      reason: input.reason,
      amount: { refund: input.amountFen, total: input.amountFen, currency: 'CNY' },
    });

    const response = await this.request<{ refund_id?: string; status?: string }>(
      'POST',
      '/v3/refund/domestic/refunds',
      body,
    );

    return { refundId: response.refund_id ?? outRefundNo, status: response.status ?? 'PROCESSING' };
  }

  /** 组装小程序 wx.requestPayment 所需参数（含二次签名） */
  private buildLaunchParams(prepayId: string): PaymentLaunchParams {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(16).toString('hex').toUpperCase();
    const packageValue = `prepay_id=${prepayId}`;
    const message = `${this.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
    const paySign = this.sign(message);

    return { channel: 'wechat', timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign };
  }

  /** 商户请求签名：`WECHATPAY2-SHA256-RSA2048` */
  private buildAuthorization(method: string, urlPath: string, body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex').toUpperCase();
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = this.sign(message);

    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.wechatPay.mchId}",` +
      `nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",` +
      `serial_no="${this.config.wechatPay.serialNo}"`
    );
  }

  private sign(message: string): string {
    if (!this.privateKey) throw new Error('商户私钥未加载');
    return createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
  }

  /** 发起微信支付 API 请求（统一超时与错误处理） */
  private async request<T>(method: 'GET' | 'POST', urlPath: string, body: string): Promise<T> {
    const response = await fetch(`${WXPAY_API_BASE}${urlPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.buildAuthorization(method, urlPath, body),
        'User-Agent': 'zhiban-server',
      },
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      // 微信错误体形如 { code, message }；原样带出便于后台排查（不含密钥）
      throw new Error(`微信支付接口返回 ${response.status}：${text.slice(0, 300)}`);
    }

    const parsed = this.parseJson<T>(text);
    if (!parsed) throw new Error('微信支付接口返回体不是合法 JSON');
    return parsed;
  }

  /** 回调解密：AES-256-GCM，密钥为 APIv3 密钥 */
  private decryptResource(resource: {
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  }): string {
    const key = Buffer.from(this.config.wechatPay.apiV3Key, 'utf8');
    if (key.length !== 32) {
      throw new Error('WXPAY_API_V3_KEY 必须为 32 字节（微信支付 V3 要求）');
    }

    const cipherBuffer = Buffer.from(resource.ciphertext, 'base64');
    const authTag = cipherBuffer.subarray(cipherBuffer.length - 16);
    const data = cipherBuffer.subarray(0, cipherBuffer.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (resource.associated_data) {
      decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  private loadPrivateKey(path: string): KeyObject {
    return createPrivateKey(readFileSync(path));
  }

  private parseJson<T>(text: string): T | null {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
