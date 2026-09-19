import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 操作主体：user 小程序用户 / admin 后台管理员 / system 定时任务与后台作业 */
export type AuditActorType = 'user' | 'admin' | 'system';

/**
 * 审计日志表（表结构见 docs/schema.sql）
 * 规格依据：《基础设施与部署方案》§4 —— 审计覆盖「报告访问、可见层级、专属卡生成、后台配置变更、越权尝试」
 * 设计取舍：
 *   - 只增不改不删（append-only），后台不提供删除入口
 *   - detail_json 存变更前后值（before/after），便于追责与回滚判断
 *   - ip 与 user_agent 用于定位异常来源；不含任何敏感正文（隐私约束 2.4）
 */
@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType: AuditActorType;

  @Column({ name: 'actor_id', type: 'bigint', unsigned: true, nullable: true })
  actorId: number | null;

  /** 动作标识，如 config_update / admin_login_failed / admin_ip_denied */
  @Column({ type: 'varchar', length: 48 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 32, nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ name: 'detail_json', type: 'json', nullable: true })
  detailJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 256, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
