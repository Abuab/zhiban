import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppRequest, AuthUser } from '../types/request-context.js';

/**
 * 取当前登录用户：@CurrentUser() user: AuthUser  /  @CurrentUser('id') userId: number
 * 仅在被 AuthGuard 保护的接口上可用（Public 接口下为 undefined）
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AppRequest>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
