import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 配对级同意类型（ADR-012 决策 1：一表多类型，预留账号级 privacy_policy） */
export const CONSENT_TYPE_INVITE_DATA = 'invite_data';
export type ConsentType = 'invite_data' | 'privacy_policy';

/**
 * 同意主体在配对中的角色
 * 有意冗余（ADR-012 风险表）：`invite` 行被删除（ADR-011）后，留证仍须能独立解释，
 * 不能再靠 `invite_id` + `user_id` 反推角色。
 */
export type ConsentRole = 'initiator' | 'invitee';

/**
 * 知情同意留证（表结构见 docs/schema.sql；ADR-012）
 *
 * 定位：**append-only 的合规证据**，与旁路审计 `audit_log` 分工 ——
 *   `audit_log` 写失败静默吞掉（旁路），本表写失败**必须阻断业务**（无留证的同意等于没有同意）。
 * 「当前是否同意」取同一 `user_id` + `consent_type` 下 `created_at` 最新一条（不更新旧行）。
 * 不建外键（全库约定）：`invite_id` 为应用层弱关联，邀请删除后留证仍在。
 */
@Entity('consent_log')
export class ConsentLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 同意主体 user.id */
  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  /** invite_data 双人数据处理；预留 privacy_policy */
  @Column({ name: 'consent_type', type: 'varchar', length: 32 })
  consentType: ConsentType;

  /** 配对级同意的关联邀请；账号级同意为 null */
  @Column({ name: 'invite_id', type: 'bigint', unsigned: true, nullable: true })
  inviteId: number | null;

  /** initiator / invitee（配对级必填） */
  @Column({ type: 'varchar', length: 16, nullable: true })
  role: ConsentRole | null;

  /** 同意时的文案版本（端点与《双人数据处理说明》正文同源） */
  @Column({ name: 'policy_version', type: 'varchar', length: 16 })
  policyVersion: string;

  /** 1 同意 / 0 拒绝（拒绝同样留证，C7「对方拒绝同意」举证用） */
  @Column({ type: 'tinyint', default: 0 })
  agreed: number;

  /** 真实客户端 IP（resolveClientIp，非代理地址） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 256, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
