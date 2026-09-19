import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 邀请状态机（PRD-002 §3）
 * 正常流：invite_created → invite_opened → consent_given → answering → completed → report_unlocked
 * 异常分支：expired（30 天未完成）/ declined（被邀请方拒绝同意）/ cancelled（发起方主动取消）
 */
export type InviteStatus =
  | 'invite_created'
  | 'invite_opened'
  | 'consent_given'
  | 'answering'
  | 'completed'
  | 'report_unlocked'
  | 'expired'
  | 'declined'
  | 'cancelled';

/**
 * 双人邀请（表结构见 docs/schema.sql 第 184-212 行）
 *
 * 规格依据：
 * - C1 邀请码绑定**首个**完成授权登录者（invitee_uid 首次写入即锁定）
 * - C4 30 天过期，可续期 1 次（+7 天）
 * - C7 换人限 1 次（replaced_from_invite_id 指向被拒绝的那条，ADR-005 决策 3）
 * - C8 邀请码 128 位随机（code 唯一键）
 * - B8 邀请创建即锁定量表版本，双方答同一快照
 */
@Entity('invite')
export class InviteEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 邀请码：128 位随机（32 位十六进制），全局唯一 */
  @Column({ type: 'varchar', length: 64 })
  code: string;

  /** 发起方 user.id */
  @Column({ name: 'initiator_uid', type: 'bigint', unsigned: true })
  initiatorUid: number;

  /** 被邀请方 user.id：首个打开并完成授权登录者（C1），此后不再变更 */
  @Column({ name: 'invitee_uid', type: 'bigint', unsigned: true, nullable: true })
  inviteeUid: number | null;

  /** 邀请创建即锁定的量表版本（B8） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  @Column({ type: 'varchar', length: 24, default: 'invite_created' })
  status: InviteStatus;

  /** 金额；P1 全免费恒为 '0.00'（DECIMAL 经 mysql2 返回字符串，本版本不参与运算） */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount: string;

  /** 是否允许被邀请方复用其历史单人答案（C3 / R7） */
  @Column({ name: 'reuse_allowed', type: 'tinyint', default: 1 })
  reuseAllowed: number;

  /** 续期次数，最多 1 次（C4） */
  @Column({ name: 'renewed_count', type: 'tinyint', unsigned: true, default: 0 })
  renewedCount: number;

  /** 换人链：指向被拒绝（declined）的那条邀请；同一 declined 行最多派生 1 条（C7） */
  @Column({ name: 'replaced_from_invite_id', type: 'bigint', unsigned: true, nullable: true })
  replacedFromInviteId: number | null;

  /** 提醒次数，最多 3 次（PRD-002 §5；ADR-005 决策 6：未送达不计数） */
  @Column({ name: 'remind_count', type: 'tinyint', unsigned: true, default: 0 })
  remindCount: number;

  @Column({ name: 'remind_at', type: 'datetime', nullable: true })
  remindAt: Date | null;

  /** 过期时间 = 创建时间 + 30 天（C4） */
  @Column({ name: 'expire_at', type: 'datetime' })
  expireAt: Date;

  @Column({ name: 'opened_at', type: 'datetime', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'declined_at', type: 'datetime', nullable: true })
  declinedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
