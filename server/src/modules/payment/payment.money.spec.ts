import { calculateCouponExpireAt, fenToYuan, yuanToFen } from './payment.money.js';

/**
 * 金额换算（模块 6，全项目唯一口径）
 *
 * 为什么值得单独测：`19.9 * 100` 在 JS 里等于 1989.9999999999998，
 * 直接取整会**少一分钱**；而金额算错一次就是一次客诉或一次资损。
 */
describe('金额换算（元 ↔ 分）', () => {
  it('元 → 分：消除浮点误差（19.9 元 = 1990 分，不是 1989）', () => {
    expect(yuanToFen(19.9)).toBe(1990);
    expect(yuanToFen(0.29)).toBe(29);
    expect(yuanToFen(8)).toBe(800);
    expect(yuanToFen(0)).toBe(0);
  });

  it('元 → 分：四舍五入到分（多余位数按分进位，不静默截断）', () => {
    expect(yuanToFen(19.995)).toBe(2000);
    expect(yuanToFen(0.004)).toBe(0);
    expect(yuanToFen(0.005)).toBe(1);
  });

  it('分 → 元：保留两位小数（19.99 元的展示口径）', () => {
    expect(fenToYuan(1990)).toBe(19.9);
    expect(fenToYuan(1999)).toBe(19.99);
    expect(fenToYuan(1)).toBe(0.01);
    expect(fenToYuan(0)).toBe(0);
  });

  it('往返一致：合法两位小数金额经 元→分→元 不变（后台改价用这个性质做校验）', () => {
    for (const yuan of [0, 0.01, 0.1, 8, 19.9, 19.99, 999999.99]) {
      expect(fenToYuan(yuanToFen(yuan))).toBe(yuan);
    }
  });

  it('往返不一致：超过两位小数的金额会被识别出来（19.999 元 → 20 元）', () => {
    expect(fenToYuan(yuanToFen(19.999))).not.toBe(19.999);
    expect(fenToYuan(yuanToFen(19.999))).toBe(20);
  });

  it('兑换码到期时间用「天数 × 24 小时」，可精确复算（E8：7 天）', () => {
    const from = new Date('2026-09-19T10:00:00.000Z');
    expect(calculateCouponExpireAt(7, from).toISOString()).toBe('2026-09-26T10:00:00.000Z');
    // 跨月末同样按小时累加，不受「月份天数不同」影响
    expect(calculateCouponExpireAt(7, new Date('2026-01-28T10:00:00.000Z')).toISOString()).toBe(
      '2026-02-04T10:00:00.000Z',
    );
  });
});
