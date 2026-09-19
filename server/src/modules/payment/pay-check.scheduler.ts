import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  PAY_CHECK_JOB_NAME,
  PAY_CHECK_PATTERN,
  PAY_CHECK_QUEUE,
  PAY_CHECK_SCHEDULER_ID,
} from './payment.constants.js';

/**
 * 每日对账的定时派发器（E1：漏单兜底的**最后一道**防线）
 *
 * 触发时间 03:10：避开 03:00 的报告/备份类任务，避免同一时刻抢资源。
 *
 * P1 说明（ADR-007 决策 1）：`free` 网关没有外部账单可查，对账结果恒为「不支持」，
 *   但代码路径必须保留 —— P2 切 `wechat` 时只改配置即可开始真正对账。
 */
@Injectable()
export class PayCheckScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PAY_CHECK_QUEUE)
    private readonly queue: Queue,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        PAY_CHECK_SCHEDULER_ID,
        { pattern: PAY_CHECK_PATTERN },
        { name: PAY_CHECK_JOB_NAME },
      );
      this.logger.log(
        `每日对账定时任务已注册：${PAY_CHECK_SCHEDULER_ID} 周期=${PAY_CHECK_PATTERN}`,
        'PayCheckScheduler',
      );
    } catch (error) {
      this.logger.error(
        `每日对账定时任务注册失败（缺对账不影响用户侧功能）：` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'PayCheckScheduler',
      );
    }
  }
}
