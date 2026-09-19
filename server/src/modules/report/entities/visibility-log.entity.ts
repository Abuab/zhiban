import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 可见层级：L1 完整版（发起方）/ L2 基础版（被邀请方）/ L3 分享版 */
export type VisibilityLevel = 'L1' | 'L2' | 'L3';

/** 审计动作：view 查看 / share_image_created 生成长图素材 / denied 越权被拒 */
export type VisibilityAction = 'view' | 'share_image_created' | 'denied';

/**
 * 报告可见性审计（表结构见 docs/schema.sql 第 258-270 行）
 *
 * 规格依据：
 * - 隐私约束 2.4 / F4：逐请求校验资源归属，越权尝试记日志可告警
 * - R3 三层可见：每次「谁以哪一层看了哪份报告」都留痕，争议时可回溯
 */
@Entity('visibility_log')
export class VisibilityLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'report_id', type: 'bigint', unsigned: true })
  reportId: number;

  @Column({ name: 'viewer_uid', type: 'bigint', unsigned: true })
  viewerUid: number;

  @Column({ type: 'varchar', length: 8 })
  level: VisibilityLevel;

  @Column({ type: 'varchar', length: 24, default: 'view' })
  action: VisibilityAction;

  /** 客户端 IP（越权排障用，取自可信代理链解析结果） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
