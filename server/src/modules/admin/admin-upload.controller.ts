import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import {
  AdminUploadService,
  MAX_IMAGE_BYTES,
  type UploadedImageFile,
  type UploadImageResult,
} from './admin-upload.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/**
 * 后台图片上传接口（ADR-010 决策 5，接口契约见 docs/api.md §17）
 * 实际路径：/api/admin/uploads/image
 *
 * ⚠️ VERSION_NEUTRAL 的理由同 AdminConfigController：避免被 defaultVersion='1' 加成
 *    /api/v1/admin/**，导致后台整站静默 404（admin-route-path.spec.ts 守护该约定）。
 *
 * ⚠️ @Public() 与 @UseGuards(AdminIpGuard, AdminAuthGuard) **必须成对**：
 *    类级 @Public() 只是让全局 AuthGuard 跳过；漏挂 AdminAuthGuard 即变成
 *    「对白名单 IP 开放」的 fail-open 漏洞。且**不**标 @AllowTotpUnbound()
 *    —— 未绑定二次验证的管理员不能上传。
 *
 * ⚠️ 用内存存储（multer 默认）而非 multer 磁盘存储：文件名必须由服务端生成，
 *    交给 multer 自己命名会把「客户端文件名不参与落盘路径」这条防线交给配置正确性。
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/uploads', version: VERSION_NEUTRAL })
export class AdminUploadController {
  constructor(private readonly adminUploadService: AdminUploadService) {}

  /** 上传单张图片（multipart/form-data，字段名 file），返回绝对 https 地址 */
  @Post('image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadImage(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<UploadImageResult> {
    return this.adminUploadService.saveImage(file, admin, buildAdminRequestMeta(request));
  }
}
