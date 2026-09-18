import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import { AdminAuthService } from './admin-auth.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import type { AdminLoginResult, AdminProfileResult, AdminTotpSetupResult } from './admin.types.js';
import { AllowTotpUnbound } from './decorators/allow-totp-unbound.decorator.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { EnableTotpDto } from './dto/enable-totp.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/**
 * 后台鉴权接口（ADR-003，接口契约见 docs/api.md §10）
 * 实际路径：/api/admin/auth/*
 *
 * ⚠️ 为什么标 VERSION_NEUTRAL：
 *   服务端启用了 URI 版本化且 defaultVersion='1'，未标版本的控制器会被自动加上 /v1
 *   （即变成 /api/v1/admin/auth/*，与 ADR-003 决策 1 约定的 /api/admin/** 不符，
 *    会导致 Nginx 与后台前端全部 404）。后台是与小程序**并行**的独立接口面，
 *   生命周期不受小程序 v1/v2 演进影响，故显式声明「不参与版本化」。
 *   回归保护见 admin-route-path.spec.ts。
 *
 * ⚠️ 类级 @Public() 的必要性与风险边界：
 *   全局 APP_GUARD 的 AuthGuard 会拦截所有路由，此处标 @Public() 让它跳过，
 *   再由 AdminAuthGuard 独立校验后台身份（ADR-003 决策 2）。
 *   即「@Public() 不等于开放」—— 本控制器的每个业务方法都挂了 AdminAuthGuard，
 *   唯一真正开放的是 login（它本来就是未登录入口，另有 IP 白名单 + 收紧限流保护）。
 *
 * ⚠️ 新增后台控制器时必须**同时**写 @Public() 与 @UseGuards(AdminIpGuard[, AdminAuthGuard])：
 *   只写 @Public() 而不挂守卫，接口会因全局 AuthGuard 被跳过而**对白名单内 IP 开放**（fail-open）；
 *   一个守卫都不写才会因全局 AuthGuard 要求小程序登录态而被拒（fail-closed）。
 */
@Public()
@UseGuards(AdminIpGuard)
@Controller({ path: 'admin/auth', version: VERSION_NEUTRAL })
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  /** 后台登录：口令 + 动态码（详见 AdminAuthService.login） */
  @RateLimit({ by: 'ip', profile: 'adminLoginIp' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto, @Req() request: AppRequest): Promise<AdminLoginResult> {
    return this.adminAuthService.login(dto, buildAdminRequestMeta(request));
  }

  /** 退出登录（仅撤销当前设备会话） */
  @AllowTotpUnbound()
  @UseGuards(AdminAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentAdmin() admin: AdminUser, @Req() request: AppRequest): Promise<{ revoked: boolean }> {
    return this.adminAuthService.logout(admin, buildAdminRequestMeta(request));
  }

  /** 当前管理员资料（未绑定二次验证时也可访问，用于前端判断是否跳绑定页） */
  @AllowTotpUnbound()
  @UseGuards(AdminAuthGuard)
  @Get('profile')
  profile(@CurrentAdmin() admin: AdminUser): Promise<AdminProfileResult> {
    return this.adminAuthService.getProfile(admin);
  }

  /** 生成二次验证密钥（返回 otpauth URL 供前端渲染二维码；此时尚未落库） */
  @AllowTotpUnbound()
  @UseGuards(AdminAuthGuard)
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  setupTotp(@CurrentAdmin() admin: AdminUser): Promise<AdminTotpSetupResult> {
    return this.adminAuthService.setupTotp(admin);
  }

  /** 提交一次动态码完成二次验证绑定 */
  @AllowTotpUnbound()
  @UseGuards(AdminAuthGuard)
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  enableTotp(
    @CurrentAdmin() admin: AdminUser,
    @Body() dto: EnableTotpDto,
  ): Promise<{ totpEnabled: true }> {
    return this.adminAuthService.enableTotp(admin, dto.code);
  }
}
