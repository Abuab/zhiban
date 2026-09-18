import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { parseDurationToSeconds } from '../../common/utils/duration.util.js';
import { RedisService } from '../redis/redis.service.js';

/** Redis 中的会话记录（TTL 与 JWT 有效期一致） */
export interface SessionRecord {
  userId: number;
  openid: string;
  createdAt: number;
  ip?: string;
  userAgent?: string;
}

const SESSION_KEY_PREFIX = 'session:';

/**
 * 会话管理（Redis）
 * 规格依据：
 *   - 边界总表 A3：同一微信可在多设备同时登录 → 每设备一个独立会话，**不互踢**
 *     理由：手机/平板/微信开发者工具并用是常态，互踢会导致答题中途被顶下线（违背 B1 断点续答体验）；
 *          安全侧通过「按设备撤销 + 账号封禁」控制风险，而非限制并发登录
 *   - 隐私约束 2.4：会话只存 userId/openid/IP/UA，不存答题内容
 * 设计：
 *   - Redis 记录存在 = 该会话有效；退出登录即删除记录（实现真正的服务端登出，JWT 无法被"撤回"）
 *   - 活跃则滑动续期，避免长答题过程中被登出
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  /** 创建新会话，返回 sessionId（同一次登录对应一个设备） */
  async create(input: {
    userId: number;
    openid: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; expiresIn: number }> {
    const sessionId = randomUUID();
    const record: SessionRecord = {
      userId: input.userId,
      openid: input.openid,
      createdAt: Date.now(),
      ip: input.ip,
      userAgent: input.userAgent,
    };
    const expiresIn = this.ttlSeconds;
    await this.redis.setJson(this.key(sessionId), record, expiresIn);
    return { sessionId, expiresIn };
  }

  /**
   * 校验会话并滑动续期（AuthGuard 每个受保护请求调用）
   * 返回 null 表示会话已失效（已登出 / 已过期 / 被撤销）
   */
  async validate(sessionId: string): Promise<SessionRecord | null> {
    const record = await this.redis.getJson<SessionRecord>(this.key(sessionId));
    if (!record) return null;
    await this.redis.expire(this.key(sessionId), this.ttlSeconds);
    return record;
  }

  /** 撤销单个会话（退出登录，只影响当前设备，其他设备不受影响 → A3 不互踢） */
  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  /** token 有效期（秒），与 JwtModule 的 expiresIn 保持一致 */
  get ttlSeconds(): number {
    return parseDurationToSeconds(this.config.get<string>('jwt.expiresIn') ?? '30d');
  }

  private key(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }
}
