import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** 时间窗口（毫秒），默认取 RATE_LIMIT_WINDOW_MS */
  windowMs?: number;
  /** 窗口内最大请求数，默认取 RATE_LIMIT_MAX */
  max?: number;
  /** 计数维度：user 按登录用户（默认）/ ip 按来源 IP */
  by?: 'user' | 'ip';
}

/**
 * 接口级限流覆盖，例如邀请码查询接口防枚举（边界总表 C8）：
 * @RateLimit({ windowMs: 60000, max: 20, by: 'ip' })
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
