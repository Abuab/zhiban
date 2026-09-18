import type { Request } from 'express';
import { isIpAllowed, resolveClientIp } from './request-ip.util.js';

/**
 * 客户端 IP 解析与白名单匹配
 * 安全背景：限流与后台 IP 白名单都依赖这两个函数。若解析可被伪造，
 *          攻击者每次换一个伪造 IP 就能绕过限流，或直接绕过后台白名单进入管理后台。
 */
describe('request-ip 工具', () => {
  const buildRequest = (input: {
    remoteAddress?: string;
    forwardedFor?: string | string[];
  }): Request =>
    ({
      headers: input.forwardedFor ? { 'x-forwarded-for': input.forwardedFor } : {},
      socket: { remoteAddress: input.remoteAddress },
    }) as unknown as Request;

  describe('resolveClientIp', () => {
    it('公网直连时忽略伪造的 X-Forwarded-For', () => {
      const ip = resolveClientIp(
        buildRequest({ remoteAddress: '198.51.100.7', forwardedFor: '203.0.113.9' }),
      );
      expect(ip).toBe('198.51.100.7');
    });

    it('本机反代时取 X-Forwarded-For 最后一段（Nginx 用 $remote_addr 覆写）', () => {
      const ip = resolveClientIp(
        buildRequest({ remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.9, 198.51.100.7' }),
      );
      expect(ip).toBe('198.51.100.7');
    });

    it('IPv4-mapped 形式的回环地址同样被视为可信反代', () => {
      const ip = resolveClientIp(
        buildRequest({ remoteAddress: '::ffff:127.0.0.1', forwardedFor: '198.51.100.7' }),
      );
      expect(ip).toBe('198.51.100.7');
    });

    it('无任何地址信息时返回 unknown（不抛错，保证守卫有确定行为）', () => {
      expect(resolveClientIp(buildRequest({}))).toBe('unknown');
    });
  });

  describe('isIpAllowed', () => {
    it('空名单一律不通过（fail-closed 由调用方决定是否放宽）', () => {
      expect(isIpAllowed('198.51.100.7', [])).toBe(false);
    });

    it('命中白名单返回 true', () => {
      expect(isIpAllowed('198.51.100.7', ['203.0.113.1', '198.51.100.7'])).toBe(true);
    });

    it('未命中白名单返回 false', () => {
      expect(isIpAllowed('198.51.100.8', ['198.51.100.7'])).toBe(false);
    });

    it('IPv4-mapped 与点分十进制视为同一地址（双栈监听场景）', () => {
      expect(isIpAllowed('::ffff:198.51.100.7', ['198.51.100.7'])).toBe(true);
      expect(isIpAllowed('198.51.100.7', ['::ffff:198.51.100.7'])).toBe(true);
    });

    it('空白与大小写差异不影响匹配', () => {
      expect(isIpAllowed('198.51.100.7', [' 198.51.100.7 '])).toBe(true);
    });

    describe('CIDR 网段', () => {
      it('IPv4 网段按前缀匹配（/24 边界内外）', () => {
        expect(isIpAllowed('198.51.100.1', ['198.51.100.0/24'])).toBe(true);
        expect(isIpAllowed('198.51.100.254', ['198.51.100.0/24'])).toBe(true);
        // 相邻网段必须落空
        expect(isIpAllowed('198.51.101.1', ['198.51.100.0/24'])).toBe(false);
        expect(isIpAllowed('198.51.99.255', ['198.51.100.0/24'])).toBe(false);
      });

      it('IPv4 /8 与 /32 端点正确（含掩码位移边界）', () => {
        expect(isIpAllowed('10.255.255.255', ['10.0.0.0/8'])).toBe(true);
        expect(isIpAllowed('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
        expect(isIpAllowed('203.0.113.7', ['203.0.113.7/32'])).toBe(true);
        expect(isIpAllowed('203.0.113.8', ['203.0.113.7/32'])).toBe(false);
      });

      it('/0 表示全放行（JS 位移量按 32 取模，需特判否则掩码失效）', () => {
        expect(isIpAllowed('203.0.113.7', ['0.0.0.0/0'])).toBe(true);
        expect(isIpAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
      });

      it('IPv6 网段按前缀匹配', () => {
        expect(isIpAllowed('2001:db8::5', ['2001:db8::/32'])).toBe(true);
        expect(isIpAllowed('2001:db9::5', ['2001:db8::/32'])).toBe(false);
        expect(isIpAllowed('::1', ['::1/128'])).toBe(true);
        expect(isIpAllowed('::2', ['::1/128'])).toBe(false);
      });

      it('IPv6 大小写与缩写写法等价', () => {
        expect(isIpAllowed('2001:DB8::5', ['2001:db8::/32'])).toBe(true);
        expect(isIpAllowed('2001:0db8:0000:0000:0000:0000:0000:0005', ['2001:db8::/32'])).toBe(true);
      });

      it('IPv4-mapped 客户端 IP 能命中 IPv4 网段（双栈监听场景）', () => {
        expect(isIpAllowed('::ffff:198.51.100.7', ['198.51.100.0/24'])).toBe(true);
      });

      it('地址族不一致不匹配（v4 客户端不会命中 v6 网段，反之亦然）', () => {
        expect(isIpAllowed('198.51.100.7', ['2001:db8::/32'])).toBe(false);
        expect(isIpAllowed('2001:db8::5', ['198.51.100.0/24'])).toBe(false);
      });

      it('非法条目一律不匹配且不抛错（fail-closed）', () => {
        const invalid = [
          '198.51.100.0/33',
          '198.51.100.0/',
          '198.51.100.0/abc',
          '999.1.1.1/24',
          '198.51.100/24',
          '2001:db8::/129',
          '2001:db8:::1/64',
          '1.2.3.4/24/8',
          '/24',
        ];
        for (const entry of invalid) {
          expect(() => isIpAllowed('198.51.100.7', [entry])).not.toThrow();
          expect(isIpAllowed('198.51.100.7', [entry])).toBe(false);
        }
      });

      it('精确地址与网段混用时任一命中即通过', () => {
        const whitelist = ['203.0.113.7', '10.0.0.0/8'];
        expect(isIpAllowed('203.0.113.7', whitelist)).toBe(true);
        expect(isIpAllowed('10.1.2.3', whitelist)).toBe(true);
        expect(isIpAllowed('203.0.113.8', whitelist)).toBe(false);
      });
    });
  });
});
