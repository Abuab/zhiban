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
  });
});
