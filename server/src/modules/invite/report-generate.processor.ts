import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  JOB_TYPE_REPORT_GENERATE,
  REPORT_GENERATE_MAX_RETRY,
  REPORT_GENERATE_QUEUE,
} from '../queue/queue.constants.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { ReportRecordService } from '../report/report-record.service.js';
import { DoubleReportGeneratorService } from './double-report-generator.service.js';
import type { ReportGenerateJob } from './invite.types.js';

/**
 * 对比报告生成消费者（模块 5，R6 + 边界总表 D1）
 *
 * 职责分工：
 *   - 生成编排（取数、算差值、落库）在 DoubleReportGeneratorService
 *   - 本消费者只负责「重试与台账」：把 BullMQ 的尝试次数翻译成 `report.retry_count` 与 `job_task.status`
 *
 * 计数口径（已核对 bullmq 6.3.8 源码 job.shouldRetryJob）：
 *   `job.attemptsMade` = 本次执行**之前**已失败的次数（首次执行为 0），
 *   故第 `attemptsMade + 1` 次尝试即当前这次；当 `attemptsMade + 1 >= attempts` 时为末次尝试。
 *   `report.retry_count` 记「不含首次的重试次数」，即当前值 = attemptsMade + 1（失败后必然消耗一次重试额度）。
 *
 * 为什么抛错而不吞掉：BullMQ 靠抛错触发退避重试；吞错会让失败的报告永远停在 pending（前端无限轮询）。
 */
@Processor(REPORT_GENERATE_QUEUE)
export class ReportGenerateProcessor extends WorkerHost {
  constructor(
    private readonly generator: DoubleReportGeneratorService,
    private readonly reportRecord: ReportRecordService,
    private readonly jobs: JobTaskService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<ReportGenerateJob>): Promise<void> {
    const inviteId = Number(job.data?.inviteId);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      // 载荷非法属编码错误，重试无意义：直接失败并把原因留在日志里
      throw new Error(`报告生成任务载荷非法：${JSON.stringify(job.data)}`);
    }

    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const task = await this.jobs.open(JOB_TYPE_REPORT_GENERATE, String(inviteId));
    await this.jobs.markRunning(task.id, attempt);

    try {
      const result = await this.generator.generate(inviteId);
      await this.jobs.markDone(task.id);
      this.logger.log(
        `报告生成任务完成：inviteId=${inviteId} 第 ${attempt}/${maxAttempts} 次尝试 结果=${result}`,
        'ReportGenerateProcessor',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt >= maxAttempts;

      if (isLastAttempt) {
        // D1 末次失败：报告置 failed（前端不再轮询）+ 台账置 failed（后台转人工工单）
        await this.reportRecord.markFailed(inviteId, REPORT_GENERATE_MAX_RETRY);
        await this.jobs.markFailed(task.id, REPORT_GENERATE_MAX_RETRY, message);
      } else {
        // 仍会重试：报告保持 pending，前端继续显示「生成中」
        await this.reportRecord.markRetrying(inviteId, attempt);
        await this.jobs.markRetrying(task.id, attempt, message);
        this.logger.warn(
          `报告生成失败，将重试：inviteId=${inviteId} 第 ${attempt}/${maxAttempts} 次 ${message}`,
          'ReportGenerateProcessor',
        );
      }
      throw error;
    }
  }
}
