import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../constants/error-code.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { AppLogger } from '../logger/app-logger.service.js';
import type { AppRequest } from '../types/request-context.js';
import type { JwtPayload } from '../../modules/auth/auth.types.js';
import { SessionService } from '../../modules/auth/session.service.js';

/**
 * 全局登录态校验（模块 2 微信登录签发 JWT）
 * 完成标准：未登录访问受保护接口返回 401
 * 校验链：
 *   1. @Public() 放行（带无效 token 的 Public 接口也放行，避免过期 token 阻断登录流程）
 *   2. 解析 Bearer token 并验签（JWT 保证不可伪造）
 *   3. Redis 会话存在性校验（保证「退出登录/封禁」能真正失效，JWT 无法被单方面撤回）
 * 降级策略：Redis 异常时放行并告警 —— 此时 token 签名仍然可信，
 *          仅丧失"会话撤销"能力，比整站不可用更可取（与 RateLimitGuard 降级一致）
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new BusinessException(ErrorCode.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch (error) {
      if (isPublic) return true;
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new BusinessException(
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHORIZED,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const session = payload.sid ? await this.sessionService.validate(payload.sid) : null;
      if (!session) {
        if (isPublic) return true;
        throw new BusinessException(
          ErrorCode.SESSION_INVALID,
          undefined,
          HttpStatus.UNAUTHORIZED,
        );
      }
      request.user = {
        id: Number(payload.sub),
        openid: payload.openid,
        sessionId: payload.sid,
      };
      return true;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      if (isPublic) return true;
      this.logger.warn(
        `会话校验失败（Redis 异常），本次按登录态放行：${error instanceof Error ? error.message : String(error)}`,
        'AuthGuard',
      );
      request.user = {
        id: Number(payload.sub),
        openid: payload.openid,
        sessionId: payload.sid,
      };
      return true;
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
