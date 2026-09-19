import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 报告状态：pending 生成中 / ready 已生成 / failed 生成失败（D1，已转人工工单） */
export type ReportStatus = 'pending' | 'ready' | 'failed';

/**
 * 双人对比报告（表结构见 docs/schema.sql 第 238-256 行）
 *
 * 唯一约束 uk_invite(invite_id)：一个邀请只产出一份报告（R6 幂等锚点）。
 * 四个 JSON 列的语义（互不重复）：
 *   - dimension_scores_json：双方各维度分 + 未评估维度清单
 *   - diffs_json：各维度绝对差 + 分级（D6 阈值归低一级）
 *   - flagged_items_json：逐题分歧明细（量表分歧 / 选择分歧）
 *   - consensus_json：共识区（仅正向）
 */
@Entity('report')
export class ReportEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'invite_id', type: 'bigint', unsigned: true, unique: true })
  inviteId: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ReportStatus;

  /** 已消耗的重试次数（不含首次尝试），上限 3（D1） */
  @Column({ name: 'retry_count', type: 'tinyint', unsigned: true, default: 0 })
  retryCount: number;

  /** 双方各维度分 + 未评估维度清单 */
  @Column({ name: 'dimension_scores_json', type: 'json' })
  dimensionScoresJson: unknown;

  /** 各维度绝对差 + 分级（<15 高共识 / 15-30 待沟通 / >30 重点待沟通） */
  @Column({ name: 'diffs_json', type: 'json' })
  diffsJson: unknown;

  /** 逐题分歧明细（R2：同题 |分差| ≥3，每维度按分差降序取前 2） */
  @Column({ name: 'flagged_items_json', type: 'json' })
  flaggedItemsJson: unknown;

  /** 共识区（仅正向，L2 基础版的唯一实质内容来源） */
  @Column({ name: 'consensus_json', type: 'json', nullable: true })
  consensusJson: unknown | null;

  /** 是否输出底线核实提示（R5） */
  @Column({ name: 'baseline_triggered', type: 'tinyint', default: 0 })
  baselineTriggered: number;

  /**
   * 渲染所用模板版本（D5 历史报告用旧模板渲染）
   * ADR-005 决策 5：只记录 **L1 模板 id**；L2/L3 模板按 (audience='double', level) 取最新
   */
  @Column({ name: 'template_version_id', type: 'bigint', unsigned: true, nullable: true })
  templateVersionId: number | null;

  @Column({ type: 'varchar', length: 16, default: '1.0' })
  version: string;

  @Column({ name: 'generated_at', type: 'datetime', nullable: true })
  generatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
