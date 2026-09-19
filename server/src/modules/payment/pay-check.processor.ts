import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { OrderService } from './order.service.js';
import {
  JOB_TYPE_PAY_CHECK,
  PAY_CHECK_BIZ_PREFIX,
  PAY_CHECK_DIFF_PREFIX,
  PAY_CHECK_QUEUE,
} from './payment.constants.js';

/** 对账回溯窗口（小时）：覆盖跨零点（23:5x 支付、00:0x 回调）的单据 */
const PAY_CHECK_WINDOW_HOURS = 24;

/**
 * 每日对账消费者（E1）
 *
 * 差异处理刻意**不抛异常**：差异是「业务事实」（漏单/金额不符/网关侧查不到），
 *   重试一百次也不会自己消失；正确动作是把台账置 `failed` 转人工工单。
 *   反之，查单本身抛错（网络抖动）也会以差异条目形式出现，同样转人工 —— 宁可多一条工单，
 *   也不要让「查单失败」被当成「对账通过」。
 *
 * bizId 用 `daily:<YYYY-MM-DD>`：同一天重复触发只复用同一行台账。
 */
@Processor(PAY_CHECK_QUEUE)
export class PayCheckProcessor extends WorkerHost {
  constructor(
    private readonly orderService: OrderService,
    private readonly jobs: JobTaskService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const now = new Date();
    const bizId = `${PAY_CHECK_BIZ_PREFIX}${now.toISOString().slice(0, 10)}`;
    const task = await this.jobs.open(JOB_TYPE_PAY_CHECK, bizId);
    await this.jobs.markRunning(task.id, job.attemptsMade);

    const from = new Date(now.getTime() - PAY_CHECK_WINDOW_HOURS * 60 * 60 * 1000);

    try {
      const result = await this.orderService.checkWithGateway(from, now);

      if (!result.supported) {
        // free / mock 网关无外部账单：如实记账为「本轮无对账能力」，不伪造成「无差异」
        await this.jobs.markDone(task.id);
        this.logger.log(
          `每日对账跳过：当前网关不支持主动查单（bizId=${bizId}）`,
          'PayCheckProcessor',
        );
        return;
      }

      if (result.differences.length === 0) {
        await this.jobs.markDone(task.id);
        this.logger.log(
          `每日对账一致：核对 ${result.checked} 笔（bizId=${bizId}）`,
          'PayCheckProcessor',
        );
        return;
      }

      await this.jobs.markFailed(
        task.id,
        job.attemptsMade + 1,
        `${PAY_CHECK_DIFF_PREFIX}共 ${result.differences.length} 笔 / 核对 ${result.checked} 笔：` +
          result.differences.join(' | '),
      );
      this.logger.error(
        `每日对账发现差异，已转人工工单：bizId=${bizId} 差异=${result.differences.length} 笔`,
        undefined,
        'PayCheckProcessor',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.markFailed(task.id, job.attemptsMade + 1, message);
      this.logger.error(
        `每日对账执行失败：bizId=${bizId} ${message}`,
        undefined,
        'PayCheckProcessor',
      );
      throw error;
    }
  }
}
