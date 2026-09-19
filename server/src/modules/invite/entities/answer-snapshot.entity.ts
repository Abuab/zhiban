import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { AnswerMap } from '../../../engines/scale/scale.types.js';

/** 作答角色：initiator 发起方 / invitee 被邀请方 */
export type SnapshotRole = 'initiator' | 'invitee';

/**
 * 答案快照（表结构见 docs/schema.sql 第 214-232 行）
 *
 * 定位：**不可变**（B8）。邀请创建时锁定量表版本，双方答同一快照；
 *   报告生成只读本表，绝不在生成时回读 answer_sheet（否则题库/答案一变，历史差值就漂移）。
 * 唯一键 uk_invite_user(invite_id, user_id)：同一邀请内每人只有一份快照（重入幂等）。
 *
 * `dimension_scores_json` 存的是与该方 `answer_sheet.dimension_scores_json` **同构**的
 *   SheetScoresCache（含 dimensions / baseline / quality / skipped），
 *   从而「新作答」与「复用历史答案（C3/R7）」两条路径可共用同一套下游逻辑。
 */
@Entity('answer_snapshot')
export class AnswerSnapshotEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'invite_id', type: 'bigint', unsigned: true })
  inviteId: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 16 })
  role: SnapshotRole;

  /** 冗余存储量表版本，防跨版本比对失真 */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 答案快照（不可变，B8） */
  @Column({ name: 'answers_json', type: 'json' })
  answersJson: AnswerMap;

  /** 与该方单人答卷同构的计分缓存（见类注释） */
  @Column({ name: 'dimension_scores_json', type: 'json' })
  dimensionScoresJson: unknown;

  /** low：低质量标记（C10 报告内统一提示，不单独暴露） */
  @Column({ name: 'quality_flag', type: 'varchar', length: 16, nullable: true })
  qualityFlag: string | null;

  /** 底线题触发（任一题 1-2 分，R5/B9） */
  @Column({ name: 'baseline_triggered', type: 'tinyint', default: 0 })
  baselineTriggered: number;

  /** 是否复用历史单人答案（C3 / R7） */
  @Column({ name: 'is_reuse', type: 'tinyint', default: 0 })
  isReuse: number;

  @Column({ name: 'duration_sec', type: 'int', unsigned: true, nullable: true })
  durationSec: number | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
