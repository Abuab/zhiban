import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { RedisConfig } from '../../config/configuration.js';

/** 滑动窗口限流结果 */
export interface RateLimitResult {
  allowed: boolean;
  /** 窗口内剩余可用次数 */
  remaining: number;
  /** 窗口重置时间戳（毫秒） */
  resetAt: number;
}

/**
 * 滑动窗口限流脚本（ZSET 实现，Lua 保证原子性）
 * KEYS[1] = 计数键；ARGV = now(ms) / window(ms) / limit / member
 * 返回 {是否放行, 剩余次数, 重置时间}
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest[2] then resetAt = tonumber(oldest[2]) + window end
  return {0, 0, resetAt}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1, now + window}
`;

/**
 * Redis 访问入口：会话缓存、答题草稿、报告缓存、限流计数、轻量队列共用
 * 规格依据：《基础设施与部署方案》§1（Redis 承担会话/缓存/队列）
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly keyPrefix: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    const redis = this.config.get<RedisConfig>('redis') as RedisConfig;
    this.keyPrefix = redis.keyPrefix;
    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      keyPrefix: redis.keyPrefix,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis 连接异常：${error.message}`, undefined, 'RedisService');
    });
    this.client.on('ready', () => {
      this.logger.log('Redis 已就绪', 'RedisService');
    });
  }

  /** 供队列/发布订阅等需要独立连接的场景使用 */
  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`缓存内容不是合法 JSON，已忽略：${key}`, 'RedisService');
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys);
  }

  /** 按前缀批量失效（如题库版本升级后清理配置缓存） */
  async delByPrefix(prefix: string): Promise<void> {
    const pattern = `${this.keyPrefix}${prefix}*`;
    let cursor = '0';
    do {
      const [next, found] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (found.length > 0) {
        // 扫描结果含 keyPrefix，需剥离后再交给带前缀的 del，避免重复加前缀
        const keys = found.map((key) =>
          key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key,
        );
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1 && ttlSeconds && ttlSeconds > 0) {
      await this.client.expire(key, ttlSeconds);
    }
    return value;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /** 滑动窗口限流：返回是否放行与剩余额度 */
  async allowBySlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    member: string,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const result = (await this.client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(windowMs),
      String(limit),
      member,
    )) as [number, number, number];

    return {
      allowed: Number(result[0]) === 1,
      remaining: Number(result[1]),
      resetAt: Number(result[2]),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
