import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { SysConfigEntity, type SysConfigValueType } from './entities/sys-config.entity.js';

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
   *
   * 值按 value_type 解释（ADR-010 决策 3.2）：
   *   string → 原样 / number → Number / boolean → 'true'|'false' → Boolean / json → JSON.parse
   */
  async getPublicConfig(): Promise<PublicConfigMap> {
    const rows = await this.repository.find({
      select: { configKey: true, configValue: true, valueType: true },
      where: { isPublic: 1 },
      order: { configKey: 'ASC' },
    });

    const result: PublicConfigMap = {};
    for (const row of rows) {
      if (!CONFIG_KEY_PATTERN.test(row.configKey)) {
        this.logger.warn(`配置键格式不合法，已跳过下发：${row.configKey}`, 'SysConfigService');
        continue;
      }
      const interpreted = this.interpretValue(row.valueType, row.configValue, row.configKey);
      if (!interpreted.ok) continue;
      this.assignNested(result, row.configKey.split('.'), interpreted.value);
    }
    return result;
  }

  /**
   * 按 value_type 解释配置值
   * 解释失败（如 json 非法、number 非数字、boolean 非 true/false）→ 跳过该键并告警：
   * fail-closed，与「配置键非法即跳过」同一口径；**不得抛错**，否则单个坏配置会让整个公开配置接口 500
   * （端上拿不到品牌名等全部配置，影响面远大于丢掉一个键）
   */
  private interpretValue(
    valueType: SysConfigValueType,
    raw: string,
    key: string,
  ): { ok: true; value: unknown } | { ok: false } {
    if (valueType === 'number') {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) {
        this.logger.warn(`配置值不是合法数字，已跳过下发：${key}`, 'SysConfigService');
        return { ok: false };
      }
      return { ok: true, value };
    }

    if (valueType === 'boolean') {
      // 只认 'true' / 'false'（后台写入时已归一为该形式）；不能直接 Boolean(raw)：
      // Boolean('false') === true，会把「关闭」下发成「开启」
      const lowered = raw.trim().toLowerCase();
      if (lowered !== 'true' && lowered !== 'false') {
        this.logger.warn(`配置值不是合法布尔值，已跳过下发：${key}`, 'SysConfigService');
        return { ok: false };
      }
      return { ok: true, value: lowered === 'true' };
    }

    if (valueType === 'json') {
      try {
        return { ok: true, value: JSON.parse(raw) };
      } catch {
        this.logger.warn(`配置值不是合法 JSON，已跳过下发：${key}`, 'SysConfigService');
        return { ok: false };
      }
    }

    // string（含未知类型）原样下发
    return { ok: true, value: raw };
  }

  /** 把 a.b.c = value 逐层写入嵌套对象 */
  private assignNested(target: PublicConfigMap, segments: string[], value: unknown): void {
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
