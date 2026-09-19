import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 异步任务状态 */
export type JobTaskStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * 异步任务表（表结构见 docs/schema.sql 第 552-564 行）
 *
 * 定位：BullMQ 负责「调度与重试」，本表负责「业务可观测」——
 *   D1 要求生成失败可转人工工单，运维要看的是「哪个邀请的报告没生成出来、错在哪」，
 *   而不是 Redis 里的 job 计数。
 */
@Entity('job_task')
export class JobTaskEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 任务类型：report_generate / share_image / invite_expire */
  @Column({ type: 'varchar', length: 32 })
  type: string;

  /** 业务主键（如 invite_id） */
  @Column({ name: 'biz_id', type: 'varchar', length: 64 })
  bizId: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: JobTaskStatus;

  /** 已消耗的重试次数（不含首次尝试） */
  @Column({ name: 'retry_count', type: 'tinyint', unsigned: true, default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', type: 'varchar', length: 512, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
