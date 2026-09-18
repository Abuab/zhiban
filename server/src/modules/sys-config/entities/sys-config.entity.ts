import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 配置值类型：决定管理后台渲染何种表单控件（ADR-002） */
export type SysConfigValueType = 'string' | 'number' | 'boolean' | 'json';

/**
 * 站点级配置表（表结构见 docs/schema.sql）
 * 规格依据：
 *   - 宪法 P5「内容与规则可配置」：品牌名等运行时文案落库维护，禁止硬编码
 *   - ADR-002：新增站点配置域，并把品牌名纳入后台可配
 * 安全约束：is_public 默认 0（fail-closed），只有显式置 1 的键才会经免鉴权接口下发
 */
@Entity('sys_config')
export class SysConfigEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 配置键，点分层级，如 brand.name */
  @Column({ name: 'config_key', type: 'varchar', length: 64 })
  configKey: string;

  /** 配置值统一存字符串，语义由 valueType 解释 */
  @Column({ name: 'config_value', type: 'text' })
  configValue: string;

  @Column({ name: 'config_group', type: 'varchar', length: 32, default: 'site' })
  configGroup: string;

  @Column({ name: 'value_type', type: 'varchar', length: 16, default: 'string' })
  valueType: SysConfigValueType;

  /** 1 = 可经 GET /api/v1/config/public 下发；0 = 仅后台可见 */
  @Column({ name: 'is_public', type: 'tinyint', default: 0 })
  isPublic: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description: string | null;

  /** 最后修改人（admin_user.id，模块 8 写入） */
  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
