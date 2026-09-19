import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { JobTaskEntity } from './job-task.entity.js';

/** last_error 列宽 VARCHAR(512)，留出余量后截断，避免「写日志失败把主流程带崩」 */
const LAST_ERROR_MAX_LENGTH = 480;

/**
 * 异步任务台账（D1：失败转人工工单）
 *
 * 与 BullMQ 的分工：
 *   - BullMQ：调度、并发、重试退避（Redis 内）
 *   - 本表：业务侧可查询的「这个邀请的报告到底生成成功没有」（MySQL 内，后台可查）
 * 幂等：同一 (type, biz_id) 在「未终结」期间复用同一行，重试不会刷出 4 条记录；
 *       终结（done/failed）后再次入队才会新开一行（对应「新一轮处理」）。
 */
@Injectable()
export class JobTaskService {
  constructor(
    @InjectRepository(JobTaskEntity)
    private readonly repository: Repository<JobTaskEntity>,
    private readonly logger: AppLogger,
  ) {}

  /** 取「进行中」的台账行，没有则新建（重试复用，不刷屏） */
  async open(type: string, bizId: string): Promise<JobTaskEntity> {
    const existing = await this.repository.findOne({
      where: { type, bizId, status: In(['pending', 'running']) },
      order: { id: 'DESC' },
    });
    if (existing) return existing;

    return this.repository.save(
      this.repository.create({ type, bizId, status: 'pending', retryCount: 0, lastError: null }),
    );
  }

  /** 标记本轮开始执行 */
  async markRunning(id: number, retryCount: number): Promise<void> {
    await this.repository.update(id, { status: 'running', retryCount });
  }

  /** 记录一次「会重试的失败」（状态仍为进行中，retry_count 递进） */
  async markRetrying(id: number, retryCount: number, error: string): Promise<void> {
    await this.repository.update(id, {
      status: 'running',
      retryCount,
      lastError: this.truncate(error),
    });
  }

  async markDone(id: number): Promise<void> {
    await this.repository.update(id, { status: 'done', lastError: null });
  }

  /** 末次失败：转人工工单（后台按 type + status='failed' 捞取） */
  async markFailed(id: number, retryCount: number, error: string): Promise<void> {
    await this.repository.update(id, {
      status: 'failed',
      retryCount,
      lastError: this.truncate(error),
    });
    this.logger.error(
      `异步任务最终失败，已转人工工单：jobTaskId=${id} 重试=${retryCount} 原因=${this.truncate(error)}`,
      undefined,
      'JobTaskService',
    );
  }

  /** 最近一条台账（排障用） */
  findLatest(type: string, bizId: string): Promise<JobTaskEntity | null> {
    return this.repository.findOne({ where: { type, bizId }, order: { id: 'DESC' } });
  }

  private truncate(message: string): string {
    return message.length > LAST_ERROR_MAX_LENGTH
      ? `${message.slice(0, LAST_ERROR_MAX_LENGTH)}…`
      : message;
  }
}
