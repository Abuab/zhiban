import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../../common/constants/error-code.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { AppRequest } from '../../../common/types/request-context.js';
import { AdminSessionService } from '../admin-session.service.js';
import { ADMIN_TOKEN_TYPE, type AdminJwtPayload } from '../admin.types.js';
import { ALLOW_TOTP_UNBOUND_KEY } from '../decorators/allow-totp-unbound.decorator.js';
import { AdminUserEntity } from '../entities/admin-user.entity.js';

/**
 * 后台鉴权守卫（ADR-003 决策 2）
 *
 * 与小程序 AuthGuard 的关系：**完全独立，不共用任何一环**
 *   - 密钥：admin.jwtSecret（ADMIN_JWT_SECRET） ≠ jwt.secret
 *   - 会话：admin_session:* ≠ session:*
 *   - 身份注入：request.admin ≠ request.user
 *
 * 校验链（任一环失败即拒绝，无「Redis 异常降级放行」的宽松分支 —— 后台是高权限入口，
 * 可用性让位于安全性：宁可后台暂时进不去，也不能在会话不可验证时放行）：
 *   1. Bearer token 存在
 *   2. 用后台密钥验签
 *   3. payload.typ === 'admin'（防跨体系令牌混用）
 *   4. Redis 会话存在（保证退出登录 / 停用能立即生效）
 *   5. 查库确认管理员仍为 active，并读取 totp_secret 是否已绑定
 *   6. 未绑定二次验证 → 除非接口标了 @AllowTotpUnbound()，否则拒绝
 *
 * ⚠️ 必须挂在**控制器类级**，且**必须**与 @Public() 成对出现（缺一不可）：
 *   后台控制器都标了 @Public() 让全局 AuthGuard 跳过，因此「标了 @Public() 却漏挂本守卫」
 *   不会 401，而是**直接对白名单内 IP 开放（fail-open）** —— 这是最容易漏的坑。
 *   反之若只挂守卫不标 @Public()，全局 AuthGuard 会先要求小程序登录态而误拒后台请求。
 *   新增后台控制器时请照抄 AdminConfigController 的装饰器组合。
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly sessionService: AdminSessionService,
    @InjectRepository(AdminUserEntity)
    private readonly adminRepository: Repository<AdminUserEntity>,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }

    const payload = await this.verifyToken(token);
    if (payload.typ !== ADMIN_TOKEN_TYPE) {
      // 载荷类型不符：即使密钥被误配成同一值，也不接受非后台令牌
      this.logger.warn('后台接口收到非后台类型令牌，已拒绝', 'AdminAuthGuard');
      throw new BusinessException(ErrorCode.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }

    const session = await this.sessionService.validate(payload.sid);
    if (!session) {
      throw new BusinessException(
        ErrorCode.SESSION_INVALID,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const admin = await this.adminRepository.findOne({ where: { id: session.adminId } });
    if (!admin || admin.status !== 'active') {
      // 账号被停用 → 已签发的所有会话立即失效（后台不需要「多设备在线」的宽容）
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED, undefined, HttpStatus.FORBIDDEN);
    }

    const totpEnabled = Boolean(admin.totpSecret);
    if (!totpEnabled) {
      const allowUnbound =
        this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_UNBOUND_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false;
      if (!allowUnbound) {
        throw new BusinessException(
          ErrorCode.ADMIN_TOTP_REQUIRED,
          undefined,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    request.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      sessionId: payload.sid,
      totpEnabled,
    };
    return true;
  }

  private async verifyToken(token: string): Promise<AdminJwtPayload> {
    try {
      return await this.jwtService.verifyAsync<AdminJwtPayload>(token, {
        secret: this.config.get<string>('admin.jwtSecret'),
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new BusinessException(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHORIZED,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private extractToken(request: AppRequest): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
    return value.trim();
  }
}
