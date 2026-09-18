import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { RateLimitConfig } from '../../config/configuration.js';
import { AccountService } from '../account/account.service.js';
import { RedisService } from '../redis/redis.service.js';
import { WechatService } from '../wechat/wechat.service.js';
import type { JwtPayload, LoginResult } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import { SessionService } from './session.service.js';

/**
 * 登录接口 route path（不含全局前缀与版本号）
 * 与 RateLimitGuard 的计数键保持一致：rl:${method}:${routePath}:${identity}
 * 说明：openid 维度必须在 code2session 之后才能计数，因此这一维度在服务内完成，
 *      IP 维度由 @RateLimit 守卫在进入业务前完成（两者叠加 = 规格要求的「IP + openid 双维度」）
 */
const LOGIN_ROUTE_PATH = '/auth/login';

/** 请求上下文（登录接口需要记录来源，便于异常登录排查） */
export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

/**
 * 登录与会话服务（模块 2）
 * 规格依据：
 *   - PRD-005 §3：启动流程 wx.login → 后端换 openid → 查 user（建档）→ 前端按权益渲染
 *   - 安全基线 §4：微信登录态校验、接口 rate limit
 *   - 边界总表 A1（token 失效后静默重登）/ A3（多设备互不影响）/ A5（失败可重试）
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly account: AccountService,
    private readonly session: SessionService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 微信登录：code → openid → 幂等建档 → 签发 JWT + 创建独立会话 */
  async login(dto: LoginDto, context: LoginContext): Promise<LoginResult> {
    const code2Session = await this.wechat.code2Session(dto.code);

    // openid 维度限流：防单账号高频刷登录、刷微信内容安全配额
    await this.assertOpenidRateLimitAllowed(code2Session.openid);

    const { user, isNew } = await this.account.ensureUserByOpenid({
      openid: code2Session.openid,
      unionid: code2Session.unionid,
    });
    this.account.assertAccountUsable(user);

    const userId = Number(user.id);
    const { sessionId, expiresIn } = await this.session.create({
      userId,
      openid: user.openid,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    const token = await this.signToken({ sub: userId, openid: user.openid, sid: sessionId });
    this.logger.log(
      `登录成功：userId=${userId} isNewUser=${isNew} scopes=1（多设备会话各自独立，不互踢 A3）`,
      'AuthService',
    );

    return {
      token,
      tokenType: 'Bearer',
      expiresIn,
      isNewUser: isNew,
      user: this.account.toProfile(user),
    };
  }

  /**
   * 续期：换发新 JWT，沿用同一 sessionId
   * 语义：不新建设备会话、不影响其他设备 → 与 A3「不互踢」一致
   * A1（换手机/重装后无感）：token 过期时小程序端直接走 login（wx.login 静默），无需用户操作
   */
  async refresh(payload: JwtPayload): Promise<LoginResult> {
    const user = await this.account.requireUsableUser(payload.sub);
    const token = await this.signToken({
      sub: Number(user.id),
      openid: user.openid,
      sid: payload.sid,
    });

    return {
      token,
      tokenType: 'Bearer',
      expiresIn: this.session.ttlSeconds,
      isNewUser: false,
      user: this.account.toProfile(user),
    };
  }

  /** 退出登录：只撤销当前设备的会话（其他设备保持登录，A3） */
  async logout(payload: JwtPayload): Promise<{ revoked: boolean }> {
    await this.session.revoke(payload.sid);
    this.logger.log(`退出登录：userId=${payload.sub}`, 'AuthService');
    return { revoked: true };
  }

  private signToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload);
  }

  /** openid 维度滑动窗口限流；Redis 异常时放行并告警（可用性优先，与 RateLimitGuard 一致） */
  private async assertOpenidRateLimitAllowed(openid: string): Promise<void> {
    const limits = this.config.get<RateLimitConfig>('rateLimit') as RateLimitConfig;
    const key = `rl:POST:${LOGIN_ROUTE_PATH}:openid:${openid}`;

    try {
      const result = await this.redis.allowBySlidingWindow(
        key,
        limits.loginWindowMs,
        limits.loginOpenidMax,
        `${Date.now()}-${randomUUID()}`,
      );
      if (result.allowed) return;
    } catch (error) {
      this.logger.warn(
        `登录限流计数失败，本次放行：${error instanceof Error ? error.message : String(error)}`,
        'AuthService',
      );
      return;
    }

    // 不输出 openid 明文（个人信息最小化）
    this.logger.warn('登录接口触发 openid 维度限流', 'AuthService');
    throw new BusinessException(
      ErrorCode.RATE_LIMITED,
      undefined,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
