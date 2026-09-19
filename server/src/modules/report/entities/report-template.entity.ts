import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 报告受众：single 单人 / double 双人（规格 PRD-002 三层可见模型只适用于 double） */
export type ReportAudience = 'single' | 'double';

/** 可见层级：L1 完整版 / L2 基础版 / L3 分享版（仅对 double 有意义） */
export type ReportLevel = 'L1' | 'L2' | 'L3';

/**
 * 报告模板（表结构见 docs/schema.sql 第 356-369 行）
 * 规格依据：
 *   - architecture.md §5「报告域」：report_template / report_template_block，改文案零发版
 *   - 宪章 P5：报告文案必须可配置，禁止硬编码
 *   - 规格 2.3：disclaimer 为每个报告页脚固定免责声明
 * 唯一键：uk_code_version(code, version)
 */
@Entity('report_template')
export class ReportTemplateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 模板编码，如 SINGLE-PRE-LITE / DOUBLE-PRE-L1 */
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 所属量表版本（渲染时按 answer_sheet.scale_version_id 匹配，保证历史报告用旧模板 D5） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 受众：single / double */
  @Column({ type: 'varchar', length: 16 })
  audience: ReportAudience;

  /** 关系状态（备婚 / 相亲）多模板分流；当前版本未启用，为 null */
  @Column({ name: 'relation_status', type: 'varchar', length: 16, nullable: true })
  relationStatus: string | null;

  /**
   * 可见层级
   * ⚠️ ADR-004 决策 3.2：三层模型只适用于 audience='double'；
   *    audience='single' 时该列固定写 'L1'（列 NOT NULL 的语义占位，不参与三层过滤）。
   *    过滤模板必须**先按 audience 再按 level**。
   */
  @Column({ type: 'varchar', length: 8 })
  level: ReportLevel;

  /** 页脚固定免责声明（规格 2.3 原文） */
  @Column({ type: 'varchar', length: 512 })
  disclaimer: string;

  @Column({ type: 'varchar', length: 16, default: '1.0' })
  version: string;

  /** 模板状态：on 启用 / off 停用 */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
