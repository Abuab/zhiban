import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import {
  AdminUploadService,
  MAX_IMAGE_BYTES,
  type UploadedImageFile,
} from './admin-upload.service.js';

vi.mock('node:fs/promises', () => {
  const mkdirMock = vi.fn();
  const writeFileMock = vi.fn();
  return { mkdir: mkdirMock, writeFile: writeFileMock, default: { mkdir: mkdirMock, writeFile: writeFileMock } };
});

/** 最小合法 PNG：magic number + 少量占位字节（本服务只看文件头） */
const PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
/** 最小合法 JPEG：magic number FF D8 FF + 占位字节 */
const JPEG_BUFFER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

const UPLOAD_DIR = '/tmp/zhiban-uploads';
const BASE_URL = 'https://m.arvine.cn';

describe('AdminUploadService 后台图片上传（ADR-010 决策 5）', () => {
  const auditLog = { record: vi.fn() };
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'upload.dir') return UPLOAD_DIR;
      if (key === 'upload.publicBaseUrl') return `${BASE_URL}/`;
      return undefined;
    }),
  };

  const admin = {
    id: 7,
    username: 'ops',
    role: 'super',
    sessionId: 's1',
    totpEnabled: true,
  } as AdminUser;
  const meta = { ip: '198.51.100.7', userAgent: 'vitest' };

  const buildService = (): AdminUploadService =>
    new AdminUploadService(
      config as unknown as ConfigService,
      auditLog as unknown as AuditLogService,
      logger as unknown as AppLogger,
    );

  const imageFile = (overrides: Partial<UploadedImageFile> = {}): UploadedImageFile => ({
    originalname: '../../evil.png',
    mimetype: 'image/png',
    size: PNG_BUFFER.length,
    buffer: PNG_BUFFER,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('真 PNG 通过：递归建目录、落盘、返回绝对 https 地址', async () => {
    const result = await buildService().saveImage(imageFile(), admin, meta);

    expect(mkdir).toHaveBeenCalledWith(UPLOAD_DIR, { recursive: true });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [target, buffer] = vi.mocked(writeFile).mock.calls[0] as [string, Buffer];
    expect(target.startsWith(`${UPLOAD_DIR}/`)).toBe(true);
    expect(buffer).toBe(PNG_BUFFER);
    expect(result.url).toMatch(/^https:\/\/m\.arvine\.cn\/uploads\/[0-9a-f]{32}\.png$/);
  });

  it('真 JPEG 通过，扩展名为 .jpg（按文件头判定，不看客户端文件名）', async () => {
    const result = await buildService().saveImage(
      imageFile({ originalname: 'qrcode.jpeg', mimetype: 'image/jpeg', buffer: JPEG_BUFFER, size: JPEG_BUFFER.length }),
      admin,
      meta,
    );

    expect(result.url).toMatch(/^https:\/\/m\.arvine\.cn\/uploads\/[0-9a-f]{32}\.jpg$/);
  });

  it('假 PNG（内容是 HTML/脚本）被拒：魔数校验不通过', async () => {
    const fake = Buffer.from('<html><script>alert(1)</script></html>');

    await expect(
      buildService().saveImage(imageFile({ buffer: fake, size: fake.length }), admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(writeFile).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('Content-Type 与魔数不符被拒（声明 png、内容是 jpeg）', async () => {
    await expect(
      buildService().saveImage(
        imageFile({ mimetype: 'image/png', buffer: JPEG_BUFFER, size: JPEG_BUFFER.length }),
        admin,
        meta,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('白名单外的 Content-Type 被拒（即使文件头是合法 PNG）', async () => {
    await expect(
      buildService().saveImage(imageFile({ mimetype: 'application/octet-stream' }), admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('超过 2MB 被拒，且不落盘', async () => {
    const oversized = Buffer.concat([PNG_BUFFER, Buffer.alloc(MAX_IMAGE_BYTES)]);

    await expect(
      buildService().saveImage(
        imageFile({ buffer: oversized, size: oversized.length }),
        admin,
        meta,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('缺少文件时被拒', async () => {
    await expect(buildService().saveImage(undefined, admin, meta)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('文件名由服务端生成：32 位随机 hex、不含客户端文件名、两次上传不重名', async () => {
    const first = await buildService().saveImage(imageFile({ originalname: 'evil.png' }), admin, meta);
    const second = await buildService().saveImage(imageFile({ originalname: 'evil.png' }), admin, meta);

    expect(first.url).not.toContain('evil');
    expect(second.url).not.toContain('evil');
    expect(first.url).not.toBe(second.url);
    expect(first.url.slice(first.url.lastIndexOf('/') + 1)).toMatch(/^[0-9a-f]{32}\.png$/);
  });

  it('落盘失败抛业务异常（不静默）并打 error 日志', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('ENOSPC: no space left'));

    await expect(buildService().saveImage(imageFile(), admin, meta)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('上传成功写审计（action=upload_image，含文件名 / 类型 / 体积）', async () => {
    const result = await buildService().saveImage(imageFile(), admin, meta);
    const filename = result.url.slice(result.url.lastIndexOf('/') + 1);

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: 7,
        action: 'upload_image',
        targetType: 'upload',
        targetId: filename,
        detail: expect.objectContaining({ filename, kind: 'png', size: PNG_BUFFER.length }),
        ip: '198.51.100.7',
        userAgent: 'vitest',
      }),
    );
  });
});
