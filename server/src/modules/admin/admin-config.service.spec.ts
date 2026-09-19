import { HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { AdminUser } from '../../common/types/request-context.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { SysConfigEntity, type SysConfigValueType } from '../sys-config/entities/sys-config.entity.js';
import { AdminConfigService } from './admin-config.service.js';

/**
 * 站点配置后台读写（ADR-003 决策 6）
 * 关键约束：只能编辑已存在的配置键（不可新增/删除）；值必须符合 value_type；
 *          每次有效变更必须写 audit_log（含变更前后值）。
 */
describe('AdminConfigService 站点配置读写', () => {
  const repository = {
    findOne: vi.fn(),
    findAndCount: vi.fn(),
    save: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const auditLog = { record: vi.fn() };

  const admin = { id: 7, username: 'ops', role: 'super', sessionId: 's1', totpEnabled: true } as AdminUser;
  const meta = { ip: '198.51.100.7', userAgent: 'vitest' };

  const buildService = (): AdminConfigService =>
    new AdminConfigService(
      repository as unknown as Repository<SysConfigEntity>,
      auditLog as unknown as AuditLogService,
    );

  const configRow = (overrides: Partial<SysConfigEntity> = {}): SysConfigEntity =>
    ({
      id: 1,
      configKey: 'brand.name',
      configValue: '品牌甲',
      configGroup: 'brand',
      valueType: 'string' as SysConfigValueType,
      isPublic: 1,
      description: null,
      updatedBy: null,
      updatedAt: new Date('2026-09-19T00:00:00Z'),
      ...overrides,
    }) as SysConfigEntity;

  beforeEach(() => {
    vi.resetAllMocks();
    repository.save.mockImplementation((entity: SysConfigEntity) => Promise.resolve(entity));
    repository.findOne.mockResolvedValue(configRow());
  });

  it('配置键不存在 → 404（从接口层杜绝新增键）', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      buildService().update('not.exist', { configValue: 'x' }, admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('内容无变化 → 400 且不写审计（避免刷审计日志）', async () => {
    await expect(
      buildService().update('brand.name', { configValue: '品牌甲' }, admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(repository.save).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('正常修改 → 落库 + 写审计（含 before/after 与操作人）', async () => {
    const result = await buildService().update(
      'brand.name',
      { configValue: '品牌乙', description: '展示名称' },
      admin,
      meta,
    );

    expect(result.configValue).toBe('品牌乙');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ configValue: '品牌乙', description: '展示名称', updatedBy: 7 }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: 7,
        action: 'config_update',
        targetId: 'brand.name',
        detail: {
          before: { configValue: '品牌甲', isPublic: 1, description: null },
          after: { configValue: '品牌乙', isPublic: 1, description: '展示名称' },
        },
        ip: '198.51.100.7',
      }),
    );
  });

  it('number 类型键写入非数字 → 400', async () => {
    repository.findOne.mockResolvedValue(configRow({ configKey: 'report.threshold', valueType: 'number' }));

    await expect(
      buildService().update('report.threshold', { configValue: '十五' }, admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('number 类型键写入合法数字 → 通过', async () => {
    repository.findOne.mockResolvedValue(configRow({ configKey: 'report.threshold', valueType: 'number' }));

    const result = await buildService().update('report.threshold', { configValue: '15' }, admin, meta);
    expect(result.configValue).toBe('15');
  });

  it('boolean 类型键把 1/0 规整为 true/false', async () => {
    repository.findOne.mockResolvedValue(configRow({ configKey: 'site.maintenance', valueType: 'boolean' }));

    const on = await buildService().update('site.maintenance', { configValue: '1' }, admin, meta);
    expect(on.configValue).toBe('true');

    repository.findOne.mockResolvedValue(configRow({ configKey: 'site.maintenance', valueType: 'boolean' }));
    const off = await buildService().update('site.maintenance', { configValue: 'false' }, admin, meta);
    expect(off.configValue).toBe('false');
  });

  it('boolean 类型键写入无关字符串 → 400', async () => {
    repository.findOne.mockResolvedValue(configRow({ configKey: 'site.maintenance', valueType: 'boolean' }));

    await expect(
      buildService().update('site.maintenance', { configValue: 'yes' }, admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('json 类型键写入非法 JSON → 400', async () => {
    repository.findOne.mockResolvedValue(configRow({ configKey: 'site.links', valueType: 'json' }));

    await expect(
      buildService().update('site.links', { configValue: '{oops}' }, admin, meta),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('可单独切换 is_public（fail-closed 开关由后台掌握）', async () => {
    const result = await buildService().update('brand.name', { isPublic: 0 }, admin, meta);

    expect(result.isPublic).toBe(0);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ isPublic: 0 }));
  });

  it('列表按分组与分页返回，并带上总数', async () => {
    repository.findAndCount.mockResolvedValue([[configRow(), configRow({ id: 2, configKey: 'brand.description' })], 2]);

    const result = await buildService().list({ group: 'brand', page: 1, pageSize: 20 });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { configGroup: 'brand' }, skip: 0, take: 20 }),
    );
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.configKey)).toEqual(['brand.name', 'brand.description']);
  });
});
