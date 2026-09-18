import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { SysConfigEntity, type SysConfigValueType } from '../sys-config/entities/sys-config.entity.js';
import type { AdminRequestMeta } from './admin.types.js';
import { AuditAction, AuditLogService } from './audit-log.service.js';
import type { QueryConfigDto, UpdateConfigDto } from './dto/query-config.dto.js';

/** 站点配置行的后台视图（不含任何内部字段） */
export interface AdminConfigItem {
  id: number;
  configKey: string;
  configValue: string;
  configGroup: string;
  valueType: SysConfigValueType;
  isPublic: number;
  description: string | null;
  updatedBy: number | null;
  updatedAt: Date;
}

export interface AdminConfigListResult {
  items: AdminConfigItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 站点配置的后台读写（ADR-003 决策 6：只改不增删）
 * 规格依据：宪章 P5 —— 品牌名等运行时文案必须后台可配、禁止硬编码
 *
 * 安全与一致性约束：
 *   1. 只接受已存在的配置键（不存在 → 404），从接口层杜绝「新增无用键」与「删键」
 *   2. 值按 value_type 校验后落库，避免把 'abc' 写进 number 键导致前端解析异常
 *   3. 每次变更写 audit_log（含变更前后值），配置漂移可追溯
 *   4. 不做 Redis 缓存：公开配置接口直查库，改完即生效（ADR-002 决策 2）
 */
@Injectable()
export class AdminConfigService {
  constructor(
    @InjectRepository(SysConfigEntity)
    private readonly repository: Repository<SysConfigEntity>,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(query: QueryConfigDto): Promise<AdminConfigListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const [rows, total] = await this.repository.findAndCount({
      where: query.group ? { configGroup: query.group } : {},
      order: { configGroup: 'ASC', configKey: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items: rows.map((row) => this.toItem(row)), total, page, pageSize };
  }

  /** 分组清单（后台左侧分组导航用，仅返回分组名与条目数） */
  async listGroups(): Promise<Array<{ group: string; count: number }>> {
    const rows = await this.repository
      .createQueryBuilder('config')
      .select('config.config_group', 'group')
      .addSelect('COUNT(*)', 'count')
      .groupBy('config.config_group')
      .orderBy('config.config_group', 'ASC')
      .getRawMany<{ group: string; count: string }>();

    return rows.map((row) => ({ group: row.group, count: Number(row.count) }));
  }

  /** 编辑单个配置项（值 / 是否公开 / 说明） */
  async update(
    configKey: string,
    dto: UpdateConfigDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<AdminConfigItem> {
    const entity = await this.repository.findOne({ where: { configKey } });
    if (!entity) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, undefined, HttpStatus.NOT_FOUND);
    }

    const nextValue =
      dto.configValue === undefined
        ? entity.configValue
        : this.normalizeValue(dto.configValue, entity.valueType, configKey);
    const nextIsPublic = dto.isPublic ?? entity.isPublic;
    const nextDescription = dto.description === undefined ? entity.description : dto.description;

    const unchanged =
      nextValue === entity.configValue &&
      nextIsPublic === entity.isPublic &&
      nextDescription === entity.description;
    if (unchanged) {
      // 无实际变更不落审计，避免后台反复点「保存」把审计日志刷满
      throw new BusinessException(ErrorCode.PARAM_INVALID, '配置内容没有变化');
    }

    const before = {
      configValue: entity.configValue,
      isPublic: entity.isPublic,
      description: entity.description,
    };

    entity.configValue = nextValue;
    entity.isPublic = nextIsPublic;
    entity.description = nextDescription;
    entity.updatedBy = admin.id;
    await this.repository.save(entity);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.CONFIG_UPDATE,
      targetType: 'sys_config',
      targetId: configKey,
      detail: {
        before,
        after: {
          configValue: nextValue,
          isPublic: nextIsPublic,
          description: nextDescription,
        },
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.toItem(entity);
  }

  /**
   * 按 value_type 校验并规整配置值
   * 规整规则的唯一目的是让「接口下发出去的值一定能被前端安全解析」：
   *   boolean 统一存 'true' / 'false'，number 拒绝非数字，json 必须能被 JSON.parse
   */
  private normalizeValue(raw: string, valueType: SysConfigValueType, key: string): string {
    const value = raw.trim();

    if (valueType === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `配置 ${key} 需要数字`);
      }
      return value;
    }

    if (valueType === 'boolean') {
      const lowered = value.toLowerCase();
      if (['1', 'true'].includes(lowered)) return 'true';
      if (['0', 'false'].includes(lowered)) return 'false';
      throw new BusinessException(ErrorCode.PARAM_INVALID, `配置 ${key} 需要布尔值`);
    }

    if (valueType === 'json') {
      try {
        JSON.parse(value);
      } catch {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `配置 ${key} 需要合法 JSON`);
      }
      return value;
    }

    return value;
  }

  private toItem(entity: SysConfigEntity): AdminConfigItem {
    return {
      id: entity.id,
      configKey: entity.configKey,
      configValue: entity.configValue,
      configGroup: entity.configGroup,
      valueType: entity.valueType,
      isPublic: entity.isPublic,
      description: entity.description,
      updatedBy: entity.updatedBy,
      updatedAt: entity.updatedAt,
    };
  }
}
