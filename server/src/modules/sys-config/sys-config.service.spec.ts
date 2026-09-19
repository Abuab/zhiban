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

  it('string 类型原样下发（brand.name 回归保护，行为零变化）', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'brand.name', configValue: '知伴', valueType: 'string' },
      // 形似数字 / 布尔的字符串在 string 类型下必须保持字符串，不得被顺手转型
      { configKey: 'site.icp', configValue: '123', valueType: 'string' },
      { configKey: 'site.slogan', configValue: 'false', valueType: 'string' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({ brand: { name: '知伴' }, site: { icp: '123', slogan: 'false' } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('number 类型转型为数字', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'report.threshold', configValue: '15', valueType: 'number' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({ report: { threshold: 15 } });
  });

  it('boolean 类型按 true/false 转型为布尔值', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'site.on', configValue: 'true', valueType: 'boolean' },
      { configKey: 'site.off', configValue: 'false', valueType: 'boolean' },
    ]);

    const result = await service.getPublicConfig();

    // 'false' 必须是 false（直接 Boolean('false') 会得到 true，属本用例守护的错误实现）
    expect(result).toEqual({ site: { on: true, off: false } });
  });

  it('json 类型按 JSON.parse 解析后下发', async () => {
    const items = ['婚史', '负债'];
    repository.find.mockResolvedValue([
      { configKey: 'safety.selfcheck.items', configValue: JSON.stringify(items), valueType: 'json' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({ safety: { selfcheck: { items } } });
  });

  it('非法 JSON 跳过该键并告警，不抛错（fail-closed）', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'safety.selfcheck.items', configValue: '{oops}', valueType: 'json' },
      { configKey: 'brand.name', configValue: '知伴', valueType: 'string' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({ brand: { name: '知伴' } });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('number / boolean 类型的非法值同样跳过并告警', async () => {
    repository.find.mockResolvedValue([
      { configKey: 'report.threshold', configValue: '十五', valueType: 'number' },
      { configKey: 'site.maintenance', configValue: 'yes', valueType: 'boolean' },
    ]);

    const result = await service.getPublicConfig();

    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
