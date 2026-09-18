import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AppLogger } from '../logger/app-logger.service.js';
import type { AppRequest } from '../types/request-context.js';
import type { RateLimitConfig } from '../../config/configuration.js';
import { RedisService } from '../../modules/redis/redis.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * 限流守卫的身份解析（重点覆盖 IP 维度防伪造）
 * 安全背景：X-Forwarded-For 可被客户端伪造，若无条件采信，
 *          攻击者每次换一个伪造 IP 即可绕过登录接口 IP 限流（实测可 100% 绕过）
 */
describe('RateLimitGuard 限流身份解析', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const config = { get: vi.fn() };
  const redis = { allowBySlidingWindow: vi.fn() };
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  let guard: RateLimitGuard;

  const limits = {
    windowMs: 60_000,
    max: 100,
    inviteWindowMs: 60_000,
    inviteMax: 30,
    loginWindowMs: 60_000,
    loginIpMax: 60,
    loginOpenidMax: 20,
  } as RateLimitConfig;

  const createContext = (request: Partial<AppRequest>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: vi.fn() }) }),
    }) as unknown as ExecutionContext;

  /** 取出守卫写入 Redis 的限流键（键里含解析出来的身份） */
  const keyOfLastCall = (): string =>
    (redis.allowBySlidingWindow.mock.calls.at(-1)?.[0] ?? '') as string;

  beforeEach(() => {
    vi.resetAllMocks();
    reflector.getAllAndOverride.mockReturnValue({ by: 'ip' });
    config.get.mockReturnValue(limits);
    redis.allowBySlidingWindow.mockResolvedValue({ allowed: true, remaining: 1, resetAt: 0 });
    guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      config as unknown as ConfigService,
      redis as unknown as RedisService,
      logger as unknown as AppLogger,
    );
  });

  it('公网直连伪造 X-Forwarded-For 不被采信，按 socket 地址计数', async () => {
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '198.51.100.7' },
    } as unknown as AppRequest;

    await guard.canActivate(createContext(request));

    expect(keyOfLastCall()).toContain('ip:198.51.100.7');
    expect(keyOfLastCall()).not.toContain('203.0.113.9');
  });

  it('本机反代转发时采信 X-Forwarded-For（取最后一段作为真实客户端 IP）', async () => {
    const request = {
      headers: { 'x-forwarded-for': '198.51.100.7' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as AppRequest;

    await guard.canActivate(createContext(request));

    expect(keyOfLastCall()).toContain('ip:198.51.100.7');
  });

  it('客户端自带伪造头 + 反代追加真实 IP 时，取最后一段而非首段', async () => {
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as AppRequest;

    await guard.canActivate(createContext(request));

    expect(keyOfLastCall()).toContain('ip:198.51.100.7');
    expect(keyOfLastCall()).not.toContain('203.0.113.9');
  });

  it('本机反代但无 X-Forwarded-For 时回落到直连地址', async () => {
    const request = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as AppRequest;

    await guard.canActivate(createContext(request));

    expect(keyOfLastCall()).toContain('ip:127.0.0.1');
  });

  it('登录接口按 IP 维度使用 loginIpMax 阈值', async () => {
    reflector.getAllAndOverride.mockReturnValue({ by: 'ip', profile: 'loginIp' });
    const request = {
      headers: {},
      socket: { remoteAddress: '198.51.100.7' },
    } as unknown as AppRequest;

    await guard.canActivate(createContext(request));

    expect(redis.allowBySlidingWindow).toHaveBeenCalledWith(
      expect.any(String),
      limits.loginWindowMs,
      limits.loginIpMax,
      expect.any(String),
    );
  });
});
