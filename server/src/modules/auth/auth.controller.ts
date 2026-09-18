import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import type { AppRequest, AuthUser } from '../../common/types/request-context.js';
import { AccountService } from '../account/account.service.js';
import type { UpdateProfileResult, UserProfile } from '../account/account.types.js';
import { UpdateProfileDto } from '../account/dto/update-profile.dto.js';
import { AuthService } from './auth.service.js';
import type { JwtPayload, LoginResult } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';

/**
 * 登录与账号接口（模块 2，接口契约见 docs/api.md）
 * 全局前缀 /api + URI 版本 v1 → 实际路径 /api/v1/auth/*
 *
 * 限流说明：
 *   - login：IP 维度（守卫，profile=loginIp）+ openid 维度（AuthService 内，code2session 之后）
 *   - profile 写：user 维度收紧到 10 次/分钟 —— 昵称检测会消耗微信内容安全配额，同时防刷审核池
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountService: AccountService,
  ) {}

  /** 微信登录（A5：失败返回明确错误码，前端可重试） */
  @Public()
  @RateLimit({ by: 'ip', profile: 'loginIp' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() request: AppRequest): Promise<LoginResult> {
    return this.authService.login(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /** 登录态续期（A1：token 到期前无感续期，用户不需要重新操作） */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@CurrentUser() user: AuthUser): Promise<LoginResult> {
    return this.authService.refresh(this.toPayload(user));
  }

  /** 退出登录（仅撤销当前设备会话） */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthUser): Promise<{ revoked: boolean }> {
    return this.authService.logout(this.toPayload(user));
  }

  /** 查询本人资料 */
  @Get('profile')
  async getProfile(@CurrentUser('id') userId: number): Promise<UserProfile> {
    return this.accountService.getProfile(userId);
  }

  /** 更新资料：昵称（A6 内容安全）/ 头像 / 隐私同意 / 年龄确认（2.4） */
  @Put('profile')
  @RateLimit({ by: 'user', windowMs: 60_000, max: 10 })
  async updateProfile(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateProfileDto,
  ): Promise<UpdateProfileResult> {
    return this.accountService.updateProfile(userId, dto);
  }

  /** 受保护接口下 AuthGuard 已保证字段齐全，此处仅做类型收敛 */
  private toPayload(user: AuthUser): JwtPayload {
    return {
      sub: user.id,
      openid: user.openid ?? '',
      sid: user.sessionId ?? '',
    };
  }
}
