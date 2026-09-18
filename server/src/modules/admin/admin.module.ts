import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysConfigEntity } from '../sys-config/entities/sys-config.entity.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminConfigController } from './admin-config.controller.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminSessionService } from './admin-session.service.js';
import { AuditLogService } from './audit-log.service.js';
import { AdminUserEntity } from './entities/admin-user.entity.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/**
 * 管理后台模块（模块 8，ADR-003）
 *
 * 本期范围（「站点域切片」，产品负责人 2026-09-19 裁决）：
 *   后台鉴权（账号密码 + TOTP + IP 白名单）+ 站点配置域读写 + 审计留痕
 * 其余 6 个配置域（量表/计分/报告/商品/内容/运营/开关）待模块 3–7 产出的数据与服务齐备后补
 *
 * 守卫说明：本模块不注册 APP_GUARD —— 后台守卫必须按控制器显式挂载，
 *          避免「全局生效」导致小程序接口被误拦（两者鉴权体系完全独立）。
 * 注意：AdminUserEntity 需在此 forFeature 注册，AdminAuthGuard 才能注入其 Repository。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AdminUserEntity, AuditLogEntity, SysConfigEntity])],
  controllers: [AdminAuthController, AdminConfigController],
  providers: [AdminAuthService, AdminSessionService, AdminConfigService, AuditLogService, AdminAuthGuard, AdminIpGuard],
})
export class AdminModule {}
