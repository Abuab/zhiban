import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { parseDurationToSeconds } from '../../common/utils/duration.util.js';
import type { AdminRole } from './entities/admin-user.entity.js';
import { RedisService } from '../redis/redis.service.js';

/** Redis 中的后台会话记录（TTL 与后台 JWT 有效期一致） */
export interface AdminSessionRecord {
  adminId: number;
  username: string;
  role: AdminRole;
  createdAt: number;
  ip?: string;
  userAgent?: string;
}

/** 后台会话键前缀：与小程序 session:* 物理隔离（ADR-003 决策 2） */
const SESSION_KEY_PREFIX = 'admin_session:';

/** 后台 JWT 默认有效期（与 configuration.ts 的 8h 默认值保持一致） */
const DEFAULT_TTL_SECONDS = 8 * 3600;

/**
 * 后台会话管理（Redis）
 * 与小程序 SessionService 的差异（刻意不复用，见 ADR-003 决策 2）：
 *   1. 键前缀独立（admin_session:），小程序侧 delByPrefix 清理不会误伤后台
 *   2. 不共享「多设备独立会话」语义：后台按需保留同样行为（各自 sid），但记录 role 供权限判断
 *   3. TTL 更短（默认 8h vs 小程序 30d）：后台是高权限入口，缩短暴露窗口
 */
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** 创建后台会话，返回 sessionId */
  async create(input: {
    adminId: number;
    username: string;
    role: AdminRole;
    ip?: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; expiresIn: number }> {
    const sessionId = randomUUID();
    const record: AdminSessionRecord = {
      adminId: input.adminId,
      username: input.username,
      role: input.role,
      createdAt: Date.now(),
      ip: input.ip,
      userAgent: input.userAgent,
    };
    const expiresIn = this.ttlSeconds;
    await this.redis.setJson(this.key(sessionId), record, expiresIn);
    return { sessionId, expiresIn };
  }

  /** 校验会话并滑动续期；返回 null 表示已登出/已过期 */
  async validate(sessionId: string): Promise<AdminSessionRecord | null> {
    const record = await this.redis.getJson<AdminSessionRecord>(this.key(sessionId));
    if (!record) return null;
    await this.redis.expire(this.key(sessionId), this.ttlSeconds);
    return record;
  }

  /** 撤销会话（退出登录） */
  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  /** token 有效期（秒），与后台 JWT 的 expiresIn 保持一致 */
  get ttlSeconds(): number {
    const configured = this.config.get<string>('admin.jwtExpiresIn');
    return configured ? parseDurationToSeconds(configured, DEFAULT_TTL_SECONDS) : DEFAULT_TTL_SECONDS;
  }

  private key(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }
}
