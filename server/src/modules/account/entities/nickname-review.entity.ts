import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 检测来源：wx = 微信内容安全接口；local = 本地敏感词兜底命中 */
export type NicknameCheckSource = 'wx' | 'local';

export type NicknameReviewStatus = 'pending' | 'approved' | 'rejected';

/**
 * 昵称人工审核池（表结构见 docs/schema.sql）
 * 规格依据：边界总表 A6「用户自填昵称含敏感词 → 昵称走内容安全接口检测；违规进人工审核池」
 * 设计要点：
 *   1. 违规昵称只入池、不覆盖 user.nickname（用户保留原昵称，不是被"拒绝"而是"待审核"）
 *   2. check_result 保留检测原始返回，供后台复核时判断依据
 *   3. 审核动作（批准/驳回）在管理后台模块 8 落地，本模块只负责入池
 */
@Entity('nickname_review')
export class NicknameReviewEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  /** 待审昵称原文 */
  @Column({ type: 'varchar', length: 64 })
  nickname: string;

  @Column({ name: 'check_source', type: 'varchar', length: 16 })
  checkSource: NicknameCheckSource;

  /** 检测明细（命中词 / 微信 suggest / label） */
  @Column({ name: 'check_result', type: 'json', nullable: true })
  checkResult: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: NicknameReviewStatus;

  /** 审核人 admin_user.id（模块 8 填写） */
  @Column({ name: 'reviewer_id', type: 'bigint', unsigned: true, nullable: true })
  reviewerId: number | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
