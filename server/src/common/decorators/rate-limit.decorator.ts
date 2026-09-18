import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * 具名阈值：取自 rateLimit 配置项，避免在装饰器里硬编码阈值（宪法 P5 禁止硬编码）
 * - invite：邀请码查询防枚举（边界总表 C8）
 * - loginIp：登录接口 IP 维度（同一出口 IP 下可能有多个真实用户，阈值放宽）
 * - loginOpenid：登录接口 openid 维度（防单账号刷登录/刷内容安全配额，阈值收紧）
 */
export type RateLimitProfile = 'invite' | 'loginIp' | 'loginOpenid';

export interface RateLimitOptions {
  /** 时间窗口（毫秒），默认取 RATE_LIMIT_WINDOW_MS */
  windowMs?: number;
  /** 窗口内最大请求数，默认取 RATE_LIMIT_MAX */
  max?: number;
  /** 计数维度：user 按登录用户（默认）/ ip 按来源 IP */
  by?: 'user' | 'ip';
  /** 具名阈值，优先级高于 windowMs / max */
  profile?: RateLimitProfile;
}

/**
 * 接口级限流覆盖，例如登录接口 IP 维度（边界总表 A5 防刷）：
 * @RateLimit({ by: 'ip', profile: 'loginIp' })
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
