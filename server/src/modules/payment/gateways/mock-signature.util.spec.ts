import {
  MOCK_SIGN_TIMESTAMP_TOLERANCE_SEC,
  buildMockSignMessage,
  signMockNotify,
  verifyMockNotify,
} from './mock-signature.util.js';

/**
 * mock 网关回调验签（ADR-007 决策 1）
 *
 * 这是模块 6「伪造回调被拒」这条完成标准的**代码路径证据**：
 * P1 没有商户号，但真实链路（微信 V3）与本文件的差异只在「用什么算法」，
 * 待签名串构造、时间戳窗口、常量时间比较这三段逻辑是同构的。
 */
describe('mock 支付回调验签', () => {
  const signKey = 'unit-test-sign-key';
  const rawBody = JSON.stringify({ out_trade_no: 'ZB20260919120000123456', amount_total: 0 });
  const nonce = 'abcdef0123456789';
  const nowSec = 1_789_742_128;

  it('待签名串为「时间戳\\n随机串\\n报文\\n」四段（与微信支付 V3 一致，末尾必须带回车换行）', () => {
    expect(buildMockSignMessage('1700', 'n1', '{"a":1}')).toBe('1700\nn1\n{"a":1}\n');
  });

  it('签名正确且在窗口内 → 通过', () => {
    const result = verifyMockNotify(
      {
        timestamp: String(nowSec),
        nonce,
        rawBody,
        signature: signMockNotify(String(nowSec), nonce, rawBody, signKey),
        signKey,
      },
      nowSec,
    );
    expect(result.ok).toBe(true);
  });

  it('签名被篡改（换密钥生成的签名）→ 拒绝', () => {
    const result = verifyMockNotify(
      {
        timestamp: String(nowSec),
        nonce,
        rawBody,
        // 攻击者不知道 signKey，只能拿自己的密钥签一份看起来合法的报文
        signature: signMockNotify(String(nowSec), nonce, rawBody, 'attacker-key'),
        signKey,
      },
      nowSec,
    );
    expect(result).toEqual({ ok: false, reason: '签名不匹配' });
  });

  it('报文被篡改（金额被改）→ 拒绝：签名覆盖整段报文，改一个字节即失效', () => {
    const signature = signMockNotify(String(nowSec), nonce, rawBody, signKey);
    const tamperedBody = JSON.stringify({
      out_trade_no: 'ZB20260919120000123456',
      amount_total: 1990,
    });

    const result = verifyMockNotify(
      { timestamp: String(nowSec), nonce, rawBody: tamperedBody, signature, signKey },
      nowSec,
    );
    expect(result).toEqual({ ok: false, reason: '签名不匹配' });
  });

  it('时间戳超出 300 秒容忍窗口 → 拒绝（防重放）', () => {
    const oldTimestamp = String(nowSec - MOCK_SIGN_TIMESTAMP_TOLERANCE_SEC - 1);
    const result = verifyMockNotify(
      {
        timestamp: oldTimestamp,
        nonce,
        rawBody,
        signature: signMockNotify(oldTimestamp, nonce, rawBody, signKey),
        signKey,
      },
      nowSec,
    );
    expect(result).toEqual({ ok: false, reason: '时间戳超出容忍窗口（防重放）' });
  });

  it('时间戳恰好处于窗口边界 → 通过（边界值不算超窗）', () => {
    const edgeTimestamp = String(nowSec - MOCK_SIGN_TIMESTAMP_TOLERANCE_SEC);
    const result = verifyMockNotify(
      {
        timestamp: edgeTimestamp,
        nonce,
        rawBody,
        signature: signMockNotify(edgeTimestamp, nonce, rawBody, signKey),
        signKey,
      },
      nowSec,
    );
    expect(result.ok).toBe(true);
  });

  it('时间戳非法 → 拒绝（不能让 NaN 走进比较逻辑）', () => {
    const result = verifyMockNotify(
      { timestamp: 'not-a-number', nonce, rawBody, signature: 'deadbeef', signKey },
      nowSec,
    );
    expect(result).toEqual({ ok: false, reason: '时间戳格式非法' });
  });

  it('签名长度不等时先比长度再看内容（timingSafeEqual 对长度不等会抛错）', () => {
    const result = verifyMockNotify(
      { timestamp: String(nowSec), nonce, rawBody, signature: 'short', signKey },
      nowSec,
    );
    expect(result).toEqual({ ok: false, reason: '签名不匹配' });
  });

  it('相同输入签名稳定（hex 小写），且不同随机串签名不同', () => {
    const a = signMockNotify(String(nowSec), nonce, rawBody, signKey);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(signMockNotify(String(nowSec), 'other-nonce', rawBody, signKey)).not.toBe(a);
  });
});
