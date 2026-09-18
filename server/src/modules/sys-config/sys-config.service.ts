import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { SysConfigEntity } from './entities/sys-config.entity.js';

/**
 * 合法配置键：点分小写标识符（如 brand.name）
 * 用途：库中若被写入 __proto__ / prototype 之类的键名，会污染返回对象的原型链，
 *      因此在组装响应前先做格式校验，非法键跳过并告警（ADR-002 决策 2 第 4 条）
 */
const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** 公开配置：按配置键的点号分层，如 brand.name → { brand: { name: '…' } } */
export type PublicConfigMap = Record<string, unknown>;

/**
 * 站点级配置服务（ADR-002）
 * 读取策略：直查库，不加 Redis 缓存 —— 公开配置仅在冷启动时读取一次（低频、行数极少），
 *          加缓存只会引入「运营改完品牌名不立即生效」的陈旧问题（见 ADR-002 决策 2）
 */
@Injectable()
export class SysConfigService {
  constructor(
    @InjectRepository(SysConfigEntity)
    private readonly repository: Repository<SysConfigEntity>,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 取可公开下发的配置（免鉴权接口使用）
   * 注意：只读 isPublic = 1 的行；任何凭据、内部阈值必须保持默认 0
   */
  async getPublicConfig(): Promise<PublicConfigMap> {
    const rows = await this.repository.find({
      select: { configKey: true, configValue: true },
      where: { isPublic: 1 },
      order: { configKey: 'ASC' },
    });

    const result: PublicConfigMap = {};
    for (const row of rows) {
      if (!CONFIG_KEY_PATTERN.test(row.configKey)) {
        this.logger.warn(`配置键格式不合法，已跳过下发：${row.configKey}`, 'SysConfigService');
        continue;
      }
      this.assignNested(result, row.configKey.split('.'), row.configValue);
    }
    return result;
  }

  /** 把 a.b.c = value 逐层写入嵌套对象 */
  private assignNested(target: PublicConfigMap, segments: string[], value: string): void {
    const lastIndex = segments.length - 1;
    let cursor = target;

    for (let index = 0; index < lastIndex; index += 1) {
      const segment = segments[index] as string;
      const existing = cursor[segment];
      // 非普通对象（含继承来的方法，如 toString）一律覆盖为新的分支，避免顺着原型链写下去
      if (existing === null || typeof existing !== 'object') {
        const branch: PublicConfigMap = {};
        cursor[segment] = branch;
        cursor = branch;
        continue;
      }
      cursor = existing as PublicConfigMap;
    }

    cursor[segments[lastIndex] as string] = value;
  }
}
