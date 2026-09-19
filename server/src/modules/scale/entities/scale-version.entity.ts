import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 量表版本（表结构见 docs/schema.sql 第 99-112 行）
 * 规格依据：
 *   - B8/G1：版本冻结后不可编辑，是邀请/答案快照的锚点（answer_sheet.scale_version_id 锁版本）
 *   - 阶段 0 裁决 D-3：SCALE-PRE-1.0 题数为 76（71 维度题含 Q27 风格题 + 5 底线题）
 * 唯一键：uk_scale_version(scale_id, version) —— 导入服务的幂等键
 */
@Entity('scale_version')
export class ScaleVersionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'scale_id', type: 'bigint', unsigned: true })
  scaleId: number;

  /** 版本号，如 1.0 */
  @Column({ type: 'varchar', length: 16 })
  version: string;

  /** 版本状态：draft 草稿 / frozen 已冻结（不可编辑，B8/G1）/ deprecated 已废弃 */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  /** 题目总数（SCALE-PRE-1.0 = 76），作答进度分母以此为准（A-1） */
  @Column({ name: 'item_count', type: 'int', unsigned: true, default: 0 })
  itemCount: number;

  /** 整卷卷首作答说明（规格第 293 行；ADR-004，P5 可配置 —— 改文案零发版） */
  @Column({ name: 'intro_text', type: 'varchar', length: 512, nullable: true })
  introText: string | null;

  /** 底线题组卷首文案（规格第 408 行；ADR-004）；无底线题组的量表为 null */
  @Column({ name: 'baseline_intro_text', type: 'varchar', length: 512, nullable: true })
  baselineIntroText: string | null;

  /** 冻结时间；冻结后不可编辑（B8/G1） */
  @Column({ name: 'frozen_at', type: 'datetime', nullable: true })
  frozenAt: Date | null;

  /** 创建人（admin_user.id；脚本导入时可为空） */
  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
