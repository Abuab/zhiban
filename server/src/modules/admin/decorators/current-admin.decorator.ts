import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminUser, AppRequest } from '../../../common/types/request-context.js';

/**
 * 取当前后台管理员：@CurrentAdmin() admin: AdminUser  /  @CurrentAdmin('id') adminId: number
 * 仅在被 AdminAuthGuard 保护的接口上可用
 */
export const CurrentAdmin = createParamDecorator(
  (field: keyof AdminUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AppRequest>();
    const admin = request.admin;
    if (!admin) return undefined;
    return field ? admin[field] : admin;
  },
);
