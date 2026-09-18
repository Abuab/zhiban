import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 昵称状态：ok 正常 / pending_review 待人工审核（A6 违规进审核池而非直接拒绝）/ rejected 审核不通过 */
export type NicknameStatus = 'ok' | 'pending_review' | 'rejected';

/** 账号状态：deleting 为注销冷静期（F1，7 天后物理删除） */
export type UserStatus = 'active' | 'disabled' | 'deleting';

/**
 * 用户表（表结构见 docs/schema.sql）
 * 规格依据：
 *   - 边界总表 A1：openid 是账号唯一标识，换手机/重装微信不变 → 权益与记录自动跟随
 *   - 边界总表 A2：换微信号无法迁移（unionid 为同主体多应用预留位）
 *   - 隐私约束 2.4：不收集真实姓名/身份证/通讯录/精确位置，故本表无对应字段
 */
@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  openid: string;

  /** 微信 unionid（同主体多应用打通时才有值，P1 仅预留） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  unionid: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname: string | null;

  @Column({ name: 'nickname_status', type: 'varchar', length: 16, default: 'ok' })
  nicknameStatus: NicknameStatus;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl: string | null;

  /** 是否已确认年满 18（隐私约束 2.4：未满 18 不可使用） */
  @Column({ name: 'age_confirmed', type: 'tinyint', default: 0 })
  ageConfirmed: number;

  @Column({ name: 'privacy_agreed_at', type: 'datetime', nullable: true })
  privacyAgreedAt: Date | null;

  @Column({ name: 'privacy_policy_version', type: 'varchar', length: 16, nullable: true })
  privacyPolicyVersion: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
