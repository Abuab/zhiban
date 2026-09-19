import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import type { AdminRequestMeta } from './admin.types.js';

/** 单张图片体积上限（ADR-010 决策 5.2；与控制器 FileInterceptor 的 limits 同源） */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 服务端默认取值（与 configuration.ts / .env.example 保持一致） */
const DEFAULT_PUBLIC_BASE_URL = 'https://m.arvine.cn';
const DEFAULT_UPLOAD_DIR = '/app/uploads';

/** Nginx 静态托管路径（deploy/nginx/m.arvine.cn.conf 的 location /uploads/） */
const PUBLIC_UPLOAD_PATH = '/uploads';

/** 允许的图片种类（由文件头 magic number 判定，不信任 Content-Type 与扩展名） */
type ImageKind = 'png' | 'jpeg';

/** 声明的 Content-Type 白名单 → 对应的真实类型（两者必须一致） */
const CONTENT_TYPE_KIND: Record<string, ImageKind> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * multer（内存存储）交给处理器的文件对象
 * 只声明本服务用到的字段：避免为 `Express.Multer.File` 全局类型额外引入 @types/multer 的全局副作用，
 * 同时让单测可以直接构造普通对象（不需要构造 multer 内部类型）
 */
export interface UploadedImageFile {
  /** 客户端文件名，仅用于审计留痕，**绝不参与落盘路径** */
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadImageResult {
  /** 绝对 https 地址（端上直接可渲染，不再自行拼域名） */
  url: string;
}

/**
 * 后台图片上传（ADR-010 决策 5.2）
 *
 * 安全约束（铁律 #6「恶意用户会怎么攻击这里」）：
 *   1. Content-Type 白名单 **与** 文件头魔数双重校验：伪装成图片的脚本/HTML 一律拒绝
 *   2. 文件名服务端生成（32 位随机 hex，128 位熵）：客户端文件名完全不参与落盘，杜绝路径穿越与覆盖
 *   3. 体积上限 2MB（控制器 multer limits 拦截，服务层再校验一次做纵深防御）
 *   4. 落盘目录只读静态托管（Nginx alias），不放任何可执行内容
 *   5. 每次上传写 audit_log（含文件名 / 类型 / 体积），上传能力不可无痕使用
 */
@Injectable()
export class AdminUploadService {
  constructor(
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly logger: AppLogger,
  ) {}

  async saveImage(
    file: UploadedImageFile | undefined,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<UploadImageResult> {
    const { buffer, kind } = this.validate(file);

    const filename = `${randomBytes(16).toString('hex')}.${kind === 'png' ? 'png' : 'jpg'}`;
    const dir = this.config.get<string>('upload.dir') ?? DEFAULT_UPLOAD_DIR;
    const target = join(dir, filename);

    try {
      // recursive: true —— 目录不存在则创建（含父级）；已存在不报错
      await mkdir(dir, { recursive: true });
      await writeFile(target, buffer);
    } catch (error) {
      this.logger.error(
        `图片落盘失败（dir=${dir}）：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'AdminUploadService',
      );
      // 不静默：上传失败必须是明确的 5xx 业务异常，避免前端把失败当成功（配置里存下不存在的地址）
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '图片保存失败，请稍后重试',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const baseUrl = this.config.get<string>('upload.publicBaseUrl') ?? DEFAULT_PUBLIC_BASE_URL;
    const url = `${baseUrl.replace(/\/+$/, '')}${PUBLIC_UPLOAD_PATH}/${filename}`;

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.UPLOAD_IMAGE,
      targetType: 'upload',
      targetId: filename,
      detail: {
        filename,
        kind,
        contentType: file?.mimetype ?? null,
        size: buffer.length,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { url };
  }

  /** 校验文件存在性、体积、魔数与声明类型，返回通过校验的 buffer 与其真实类型 */
  private validate(file: UploadedImageFile | undefined): { buffer: Buffer; kind: ImageKind } {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择要上传的图片文件');
    }

    if (file.buffer.length > MAX_IMAGE_BYTES || file.size > MAX_IMAGE_BYTES) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '图片不能超过 2MB');
    }

    const kind = this.detectKind(file.buffer);
    if (!kind) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '仅支持 PNG / JPEG 格式的图片');
    }

    const declaredKind = CONTENT_TYPE_KIND[file.mimetype.toLowerCase()];
    if (!declaredKind) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        '仅支持 image/png 或 image/jpeg 类型',
      );
    }
    if (declaredKind !== kind) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '文件内容与声明的图片类型不符');
    }

    return { buffer: file.buffer, kind };
  }

  /** 读文件头判断真实类型（PNG `89 50 4E 47` / JPEG `FF D8 FF`），无法识别返回 null */
  private detectKind(buffer: Buffer): ImageKind | null {
    if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      return 'png';
    }
    if (
      buffer.length >= JPEG_MAGIC.length &&
      buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)
    ) {
      return 'jpeg';
    }
    return null;
  }
}
