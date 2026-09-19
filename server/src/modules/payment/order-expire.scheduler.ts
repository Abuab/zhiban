import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  ORDER_EXPIRE_JOB_NAME,
  ORDER_EXPIRE_PATTERN,
  ORDER_EXPIRE_QUEUE,
  ORDER_EXPIRE_SCHEDULER_ID,
} from './payment.constants.js';

/**
 * 未支付订单超时关闭的定时派发器（E3：下单后 30 分钟保留期）
 *
 * 与模块 5 的邀请过期扫描同构（ADR-005 决策 4）：用 BullMQ `upsertJobScheduler`
 *   而不是引入 @nestjs/schedule —— 队列已依赖 Redis，多一个调度框架只会多一套
 *   「多实例部署会不会重复跑」的心智负担；`upsertJobScheduler` 本身幂等。
 *
 * 降级：注册失败（Redis 不可用）不阻断启动 —— `OrderService.findOpenOrder` 有懒判定兜底
 *   （下单复用检查时顺手关闭已过期订单），只是关闭会延迟到用户下次下单才发生。
 */
@Injectable()
export class OrderExpireScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ORDER_EXPIRE_QUEUE)
    private readonly queue: Queue,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        ORDER_EXPIRE_SCHEDULER_ID,
        { pattern: ORDER_EXPIRE_PATTERN },
        { name: ORDER_EXPIRE_JOB_NAME },
      );
      this.logger.log(
        `订单超时关闭定时任务已注册：${ORDER_EXPIRE_SCHEDULER_ID} 周期=${ORDER_EXPIRE_PATTERN}`,
        'OrderExpireScheduler',
      );
    } catch (error) {
      this.logger.error(
        `订单超时关闭定时任务注册失败（懒判定兜底仍生效）：` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'OrderExpireScheduler',
      );
    }
  }
}
