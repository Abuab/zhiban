import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * mock 支付网关的签名工具（仅联调演练用，ADR-007 决策 1）
 *
 * 为什么复用微信支付 V3 的头名与待签名串构造：
 *   回调处理代码只有一套（验签 → 落 payment_notify_log → 幂等 → 入账），
 *   头名与签名串格式对齐后，mock 演练覆盖的正是真实链路上最容易写错的那段。
 */
export const MOCK_SIGN_HEADER_TIMESTAMP = 'wechatpay-timestamp';
export const MOCK_SIGN_HEADER_NONCE = 'wechatpay-nonce';
export const MOCK_SIGN_HEADER_SIGNATURE = 'wechatpay-signature';

/** 时间戳容忍窗口（秒）：与微信支付 V3 一致，防重放 */
export const MOCK_SIGN_TIMESTAMP_TOLERANCE_SEC = 300;

/** 待签名串：`时间戳\n随机串\n报文主体\n` */
export function buildMockSignMessage(timestamp: string, nonce: string, rawBody: string): string {
  return `${timestamp}\n${nonce}\n${rawBody}\n`;
}

/** 生成签名（hex，HmacSHA256） */
export function signMockNotify(
  timestamp: string,
  nonce: string,
  rawBody: string,
  signKey: string,
): string {
  return createHmac('sha256', signKey)
    .update(buildMockSignMessage(timestamp, nonce, rawBody), 'utf8')
    .digest('hex');
}

/**
 * 校验签名
 * @param nowSec 当前时间（秒），显式传入以便单测覆盖「时间戳过期」分支
 */
export function verifyMockNotify(
  params: { timestamp: string; nonce: string; rawBody: string; signature: string; signKey: string },
  nowSec: number,
): { ok: boolean; reason?: string } {
  const { timestamp, nonce, rawBody, signature, signKey } = params;

  const timestampSec = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSec)) {
    return { ok: false, reason: '时间戳格式非法' };
  }
  if (Math.abs(nowSec - timestampSec) > MOCK_SIGN_TIMESTAMP_TOLERANCE_SEC) {
    return { ok: false, reason: '时间戳超出容忍窗口（防重放）' };
  }

  const expected = signMockNotify(timestamp, nonce, rawBody, signKey);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  // 长度不等时 timingSafeEqual 会抛错，故先比长度（长度本身不是秘密）
  if (expectedBuffer.length !== actualBuffer.length) {
    return { ok: false, reason: '签名不匹配' };
  }
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, reason: '签名不匹配' };
  }
  return { ok: true };
}
