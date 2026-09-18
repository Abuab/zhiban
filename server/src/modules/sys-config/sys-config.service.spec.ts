import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { SysConfigEntity } from './entities/sys-config.entity.js';
import { SysConfigService } from './sys-config.service.js';

describe('SysConfigService 站点公开配置', () => {
  let service: SysConfigService;
  const repository = { find: vi.fn() };
  const logger = { warn: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SysConfigService,
        { provide: getRepositoryToken(SysConfigEntity), useValue: repository },
        { provide: AppLogger, useValue: logger },
      ],
    }).compile();
    service = moduleRef.get(SysConfigService);
  });

  it('只取 is_public = 1 的配置（fail-closed）', async () => {
    repository.find.mockResolvedValue([]);

    await service.getPublicConfig();

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isPublic: 1 } }),
    );
  });

  it('点分键按层级组装为嵌套对象', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'brand.name', configValue: '知伴' },
      { configKey: 'brand.footer.slogan', configValue: '仅供自我了解' },
      { configKey: 'site.icp', configValue: '京ICP备00000000号' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({
      brand: { name: '知伴', footer: { slogan: '仅供自我了解' } },
      site: { icp: '京ICP备00000000号' },
    });
  });

  it('非法配置键跳过并告警，不进入响应体', async () => {
    repository.find.mockResolvedValue([
      { configKey: '__proto__', configValue: 'polluted' },
      { configKey: 'Brand.Name', configValue: '大写不合法' },
      { configKey: 'brand.name', configValue: '知伴' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({ brand: { name: '知伴' } });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('键名与原型链成员同名时只写自有属性，不污染原型链', async () => {
    // constructor 是小写合法键名，且 Object.prototype 上恰好存在同名成员
    repository.find.mockResolvedValue([{ configKey: 'constructor.name', configValue: 'x' }]);

    const result = await service.getPublicConfig();

    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ constructor: { name: 'x' } });
    // 原型上的成员未被改写
    expect(typeof (Object.prototype as unknown as Record<string, unknown>).constructor).toBe(
      'function',
    );
  });
});
