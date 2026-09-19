import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { OrderService } from './order.service.js';
import {
  JOB_TYPE_ORDER_EXPIRE,
  ORDER_EXPIRE_BIZ_PREFIX,
  ORDER_EXPIRE_QUEUE,
} from './payment.constants.js';

/**
 * 未支付订单超时关闭消费者（E3）
 *
 * 台账 bizId 用 `scan:<ISO 分钟>`：每轮一条，重复触发同一轮只复用同一行，
 * 后台既能看出「这轮关了几笔」，又不会被每天 144 条记录刷屏。
 *
 * 业务逻辑全部下沉到 `OrderService.closeOverdue`（单条 UPDATE 命中所有超期行），
 * 处理器只负责台账与错误上报 —— 保证「定时跑」与「懒判定兜底」走的是同一段代码。
 */
@Processor(ORDER_EXPIRE_QUEUE)
export class OrderExpireProcessor extends WorkerHost {
  constructor(
    private readonly orderService: OrderService,
    private readonly jobs: JobTaskService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    // toISOString 前 16 位即 `YYYY-MM-DDTHH:mm`，按分钟聚合（周期为 10 分钟，不会撞轮）
    const bizId = `${ORDER_EXPIRE_BIZ_PREFIX}${new Date().toISOString().slice(0, 16)}`;
    const task = await this.jobs.open(JOB_TYPE_ORDER_EXPIRE, bizId);
    await this.jobs.markRunning(task.id, job.attemptsMade);

    try {
      const closedCount = await this.orderService.closeOverdue();
      await this.jobs.markDone(task.id);
      this.logger.log(
        `订单超时关闭扫描完成：本轮关闭 ${closedCount} 笔（bizId=${bizId}）`,
        'OrderExpireProcessor',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.markFailed(task.id, job.attemptsMade + 1, message);
      this.logger.error(
        `订单超时关闭扫描失败：bizId=${bizId} ${message}`,
        undefined,
        'OrderExpireProcessor',
      );
      throw error;
    }
  }
}
