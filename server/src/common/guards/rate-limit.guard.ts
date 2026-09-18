import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ErrorCode } from '../constants/error-code.js';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
  type RateLimitProfile,
} from '../decorators/rate-limit.decorator.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { AppLogger } from '../logger/app-logger.service.js';
import type { AppRequest } from '../types/request-context.js';
import type { RateLimitConfig } from '../../config/configuration.js';
import { RedisService } from '../../modules/redis/redis.service.js';

/**
 * 可信任的反代来源：仅本机回环地址
 * 当前部署形态为「Nginx 与 API 同机」，反代必然以 127.0.0.1 回源；
 * 公网直连（含被绕过 Nginx 直打端口）一律不采信 X-Forwarded-For
 */
const TRUSTED_PROXY_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 全局限流（边界总表 F5 爬虫刷接口 / C8 邀请码枚举）
 * 实现说明：以 Guard 形式挂在 AuthGuard 之后，从而拿到登录身份，按 openid 计数
 *          （规格《基础设施与部署方案》§4：接口全局 rate limit「按 openid」）
 * 降级策略：Redis 异常时放行并告警（可用性优先；此时依赖 Redis 的会话能力已不可用，风险可控）
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    const limits = this.config.get<RateLimitConfig>('rateLimit') as RateLimitConfig;
    const profile = options.profile ? this.resolveProfile(options.profile, limits) : undefined;
    const windowMs = profile?.windowMs ?? options.windowMs ?? limits.windowMs;
    const max = profile?.max ?? options.max ?? limits.max;
    const by = options.by ?? 'user';

    const request = context.switchToHttp().getRequest<AppRequest>();
    const identity = this.resolveIdentity(request, by);
    const path = request.route?.path ?? request.path;
    const key = `rl:${request.method}:${path}:${identity}`;

    try {
      const result = await this.redis.allowBySlidingWindow(
        key,
        windowMs,
        max,
        `${Date.now()}-${randomUUID()}`,
      );

      if (!result.allowed) {
        const response = context.switchToHttp().getResponse<Response>();
        response.setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
        );
        throw new BusinessException(
          ErrorCode.RATE_LIMITED,
          undefined,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(
        `限流计数失败，本次放行：${error instanceof Error ? error.message : String(error)}`,
        'RateLimitGuard',
      );
    }

    return true;
  }

  /** 具名阈值 → 实际数值（集中在配置里维护，见 configuration.ts） */
  private resolveProfile(
    profile: RateLimitProfile,
    limits: RateLimitConfig,
  ): { windowMs: number; max: number } {
    if (profile === 'invite') {
      return { windowMs: limits.inviteWindowMs, max: limits.inviteMax };
    }
    if (profile === 'loginIp') {
      return { windowMs: limits.loginWindowMs, max: limits.loginIpMax };
    }
    return { windowMs: limits.loginWindowMs, max: limits.loginOpenidMax };
  }

  private resolveIdentity(request: AppRequest, by: 'user' | 'ip'): string {
    const ip = this.resolveIp(request);
    if (by === 'ip') return `ip:${ip}`;
    if (request.user?.openid) return `openid:${request.user.openid}`;
    if (request.user) return `uid:${request.user.id}`;
    // 未登录（登录接口等 Public 路由）退化为 IP 维度
    return `ip:${ip}`;
  }

  /**
   * 解析客户端 IP
   * 安全约束（防刷基线）：X-Forwarded-For 是客户端可任意伪造的请求头，
   *   只有「直连方是本机可信反代（Nginx 与 API 同机）」时才采信，并取最后一段
   *   （Nginx 用 $remote_addr 覆写该头后，最后一段即真实客户端 IP）。
   *   若不加这层判断，恶意客户端每次换一个伪造 IP 就能拿到全新限流桶，IP 限流形同虚设。
   * 注意：将来若前置 CDN，需要把 CDN 回源地址加入可信列表，否则会退化为按 CDN 节点计数。
   */
  private resolveIp(request: AppRequest): string {
    const direct = request.socket?.remoteAddress ?? request.ip ?? '';
    if (!TRUSTED_PROXY_ADDRESSES.has(direct)) {
      return direct || 'unknown';
    }

    const forwarded = request.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const hops = (raw ?? '')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);

    return hops.length > 0 ? hops[hops.length - 1] : direct;
  }
}
