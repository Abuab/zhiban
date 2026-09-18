import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { SysConfigService, type PublicConfigMap } from './sys-config.service.js';

/**
 * 站点配置接口（ADR-002，接口契约见 docs/api.md §9）
 * 实际路径：/api/v1/config/public
 *
 * 为什么免鉴权：品牌名在登录前就要展示（登录页标题、授权弹窗、隐私政策页、导航栏），
 *              此时用户没有 token，无法调用需鉴权接口。
 * 安全边界：只下发 is_public = 1 的键；按 IP 限流防爬；响应体不得包含任何凭据类配置。
 */
@Controller('config')
export class SysConfigController {
  constructor(private readonly sysConfigService: SysConfigService) {}

  /** 站点公开配置 */
  @Public()
  @RateLimit({ by: 'ip' })
  @Get('public')
  getPublicConfig(): Promise<PublicConfigMap> {
    return this.sysConfigService.getPublicConfig();
  }
}
