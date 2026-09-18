import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * labels_json 内容：三级分级命名（中性表述，P7）
 * 规格依据：题库「计分与判定规则」第 5 条 —— <15 高共识 / 15-30 待沟通 / >30 重点待沟通（D6）
 */
export interface ScoringRuleLabels {
  high: string;
  mid: string;
  low: string;
}

/**
 * 计分域配置（表结构见 docs/schema.sql 第 337-353 行）
 * 规格依据：
 *   - 阶段 0 裁决 D-2：维度聚合 mean_normalized = (均分 - 1) × 25 → 0-100
 *   - D6：差值阈值后台可配，恰在阈值归入较低一级
 *   - B3：低质量判定（作答总时长 < 3 分钟）
 * 唯一键：uk_scale_version_rule(scale_version_id, version) —— 导入服务按此幂等写入默认计分行
 */
@Entity('scoring_rule')
export class ScoringRuleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 所属版本（scale_version.id） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 维度聚合方式：mean_normalized = (均分 - 1) × 25 → 0-100（D-2） */
  @Column({ name: 'aggregate_method', type: 'varchar', length: 32, default: 'mean_normalized' })
  aggregateMethod: string;

  /** 差值下限（含），归入较低一级（D6） */
  @Column({ name: 'diff_threshold_high', type: 'int', default: 15 })
  diffThresholdHigh: number;

  /** 差值上限（含），归入较低一级（D6） */
  @Column({ name: 'diff_threshold_mid', type: 'int', default: 30 })
  diffThresholdMid: number;

  /** 分级命名：高共识 / 待沟通 / 重点待沟通（中性，P7） */
  @Column({ name: 'labels_json', type: 'json' })
  labelsJson: ScoringRuleLabels;

  /** 低质量判定：总时长 < 3 分钟（B3） */
  @Column({ name: 'quality_min_sec', type: 'int', unsigned: true, default: 180 })
  qualityMinSec: number;

  /** 规则版本号 */
  @Column({ type: 'varchar', length: 16, default: '1.0' })
  version: string;

  /** 规则状态：on 生效 / off 停用 */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  /** 最后修改人（admin_user.id） */
  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
