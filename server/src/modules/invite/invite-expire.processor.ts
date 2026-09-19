import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  INVITE_EXPIRE_BIZ_PREFIX,
  INVITE_EXPIRE_QUEUE,
  JOB_TYPE_INVITE_EXPIRE,
} from '../queue/queue.constants.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { InviteEntity } from './entities/invite.entity.js';
import { EXPIRABLE_INVITE_STATUSES, INVITE_STATUS } from './invite.constants.js';

/**
 * 邀请过期扫描消费者（C4）
 *
 * 实现取「一条 UPDATE 命中全部超期行」而不是「先查后逐行改」：
 *   - 单条语句天然并发安全（多实例同时跑也只是把同样的行改成同样的状态）
 *   - 条件里带 `status IN (可过期集合)`，已 completed / report_unlocked / 终态的行绝不会被误伤
 *
 * 台账 bizId 用 `scan:<ISO 小时>`：每小时一条（重复触发同一小时也只复用同一行），
 * 运维在后台既能看出「这轮扫了几条」，又不会被每天 24 条记录刷屏。
 */
@Processor(INVITE_EXPIRE_QUEUE)
export class InviteExpireProcessor extends WorkerHost {
  constructor(
    @InjectRepository(InviteEntity)
    private readonly inviteRepository: Repository<InviteEntity>,
    private readonly jobs: JobTaskService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const now = new Date();
    // toISOString 前 13 位即 `YYYY-MM-DDTHH`，按小时聚合
    const bizId = `${INVITE_EXPIRE_BIZ_PREFIX}${now.toISOString().slice(0, 13)}`;
    const task = await this.jobs.open(JOB_TYPE_INVITE_EXPIRE, bizId);
    await this.jobs.markRunning(task.id, job.attemptsMade);

    try {
      const result = await this.inviteRepository
        .createQueryBuilder()
        .update(InviteEntity)
        .set({ status: INVITE_STATUS.EXPIRED })
        .where('status IN (:...statuses)', { statuses: [...EXPIRABLE_INVITE_STATUSES] })
        .andWhere('expire_at < :now', { now })
        .execute();

      const expiredCount = result.affected ?? 0;
      await this.jobs.markDone(task.id);
      this.logger.log(
        `邀请过期扫描完成：本轮置过期 ${expiredCount} 条（bizId=${bizId}）`,
        'InviteExpireProcessor',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.markFailed(task.id, job.attemptsMade + 1, message);
      this.logger.error(
        `邀请过期扫描失败：bizId=${bizId} ${message}`,
        undefined,
        'InviteExpireProcessor',
      );
      throw error;
    }
  }
}
