import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  INVITE_EXPIRE_JOB_NAME,
  INVITE_EXPIRE_PATTERN,
  INVITE_EXPIRE_QUEUE,
  INVITE_EXPIRE_SCHEDULER_ID,
} from '../queue/queue.constants.js';

/**
 * 邀请过期扫描的定时派发器（C4：30 天未 completed → expired）
 *
 * 为什么用 BullMQ job scheduler 而不是 @nestjs/schedule（ADR-005 决策 4）：
 *   队列已经依赖 Redis，再多引一个调度框架只会多一套「多实例下会不会重复跑」的心智负担；
 *   而 `upsertJobScheduler` 本身幂等（同一 id 重复注册只更新不叠加），
 *   多实例部署时也不会跑出多条定时任务。
 *
 * 降级：注册失败（Redis 不可用）不阻断启动 —— 懒判定兜底仍然生效
 *   （InviteService 每次按邀请码取数时会顺手判一次是否过期），
 *   健康检查的 /api/health/ready 也会暴露 Redis 状态。
 */
@Injectable()
export class InviteExpireScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(INVITE_EXPIRE_QUEUE)
    private readonly queue: Queue,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        INVITE_EXPIRE_SCHEDULER_ID,
        { pattern: INVITE_EXPIRE_PATTERN },
        { name: INVITE_EXPIRE_JOB_NAME },
      );
      this.logger.log(
        `邀请过期扫描定时任务已注册：${INVITE_EXPIRE_SCHEDULER_ID} 周期=${INVITE_EXPIRE_PATTERN}`,
        'InviteExpireScheduler',
      );
    } catch (error) {
      this.logger.error(
        `邀请过期扫描定时任务注册失败（懒判定兜底仍生效）：` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'InviteExpireScheduler',
      );
    }
  }
}
