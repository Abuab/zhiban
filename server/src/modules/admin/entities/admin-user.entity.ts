import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 管理员角色：super 可管理全部配置域；operator 仅可操作被授权的域（P6 一人可运营，P1 不做细粒度权限） */
export type AdminRole = 'super' | 'operator';

/** 管理员状态：active 正常 / disabled 停用（保留记录，不做物理删除，便于审计追溯） */
export type AdminStatus = 'active' | 'disabled';

/**
 * 后台管理员表（表结构见 docs/schema.sql）
 * 规格依据：安全基线 §4「管理后台：独立路径 + IP 白名单 + 账号密码 + 二次验证；后台接口与小程序接口分离鉴权」
 * 账号来源：由一次性 CLI 脚本创建（ADR-003 决策 4），禁止 SQL 种子写入口令
 * 安全约束：
 *   - password_hash 存 bcrypt 结果，任何日志/响应都不得输出该字段
 *   - totp_secret 为空表示尚未绑定二次验证 → 登录后仅可访问绑定接口（AdminAuthGuard 强制）
 */
@Entity('admin_user')
export class AdminUserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  username: string;

  /** bcrypt 哈希（含盐），长度 60，字段预留 128 以兼容未来算法升级 */
  @Column({ name: 'password_hash', type: 'varchar', length: 128 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 32, default: 'operator' })
  role: AdminRole;

  /** 二次验证密钥（Base32）；NULL = 未绑定 */
  @Column({ name: 'totp_secret', type: 'varchar', length: 64, nullable: true })
  totpSecret: string | null;

  /** 逗号分隔 IP 白名单（单个管理员级更细的约束；全局白名单见 ADMIN_ALLOWED_IPS） */
  @Column({ name: 'ip_whitelist', type: 'varchar', length: 512, nullable: true })
  ipWhitelist: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AdminStatus;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
