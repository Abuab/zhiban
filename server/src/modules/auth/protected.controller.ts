import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../common/types/request-context.js';

/**
 * 登录态探针（模块 2 完成标准：未登录访问 /api/v1/protected 返回 401）
 * 用途：
 *   1. 联调与验收时快速确认「登录中间件是否生效」
 *   2. 小程序端启动时可选用它校验本地 token 是否仍有效
 * 约束：不返回任何业务数据与账号标识，仅回显当前 userId（无敏感信息）
 */
@Controller('protected')
export class ProtectedController {
  @Get()
  probe(@CurrentUser() user: AuthUser): { userId: number; loggedIn: true } {
    return { userId: user.id, loggedIn: true };
  }
}
