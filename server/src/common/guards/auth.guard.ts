import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../constants/error-code.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { BusinessException } from '../exceptions/business.exception.js';
import type { AppRequest } from '../types/request-context.js';

interface JwtPayload {
  /** user.id */
  sub: number;
  openid?: string;
}

/**
 * 全局登录态校验（模块 2 微信登录签发 JWT）
 * 完成标准：未登录访问受保护接口返回 401
 * 规则：@Public() 标记的接口放行；带无效 token 的 Public 接口也放行（不因过期 token 阻断登录相关流程）
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
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

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = { id: Number(payload.sub), openid: payload.openid };
      return true;
    } catch (error) {
      if (isPublic) return true;
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
