import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import {
  AdminConfigService,
  type AdminConfigItem,
  type AdminConfigListResult,
} from './admin-config.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { QueryConfigDto, UpdateConfigDto } from './dto/query-config.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/**
 * 后台站点配置接口（ADR-003，接口契约见 docs/api.md §11）
 * 实际路径：/api/admin/configs*
 *
 * ⚠️ VERSION_NEUTRAL 的理由同 AdminAuthController（避免被 defaultVersion='1' 加成 /api/v1/admin/**）。
 *
 * ⚠️ 类级 @Public() 仅用于让全局 AuthGuard 跳过（见 AdminAuthController 的同名说明）；
 *    本控制器全部接口由 AdminAuthGuard 独立守卫，且**不**标 @AllowTotpUnbound()
 *    —— 即未绑定二次验证的管理员不能读写配置。
 *
 * 能力边界（ADR-003 决策 6）：只读列表 + 编辑已有项，**不支持新增/删除配置键**。
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/configs', version: VERSION_NEUTRAL })
export class AdminConfigController {
  constructor(private readonly adminConfigService: AdminConfigService) {}

  /** 配置分组清单（后台分组导航） */
  @Get('groups')
  listGroups(): Promise<Array<{ group: string; count: number }>> {
    return this.adminConfigService.listGroups();
  }

  /** 配置分页列表 */
  @Get()
  list(@Query() query: QueryConfigDto): Promise<AdminConfigListResult> {
    return this.adminConfigService.list(query);
  }

  /** 编辑单个配置项（值 / 是否公开 / 说明），变更写 audit_log */
  @Patch(':configKey')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('configKey') configKey: string,
    @Body() dto: UpdateConfigDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<AdminConfigItem> {
    return this.adminConfigService.update(configKey, dto, admin, buildAdminRequestMeta(request));
  }
}
