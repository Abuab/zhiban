import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { isDuplicateKeyError } from '../../common/utils/db-error.util.js';
import { RedisService } from '../redis/redis.service.js';
import { ReportEntity } from './entities/report.entity.js';
import { VisibilityLogEntity, type VisibilityAction, type VisibilityLevel } from './entities/visibility-log.entity.js';
import { REPORT_STATUS, REPORT_VIEW_CACHE_PREFIX } from './report.constants.js';
import type { StoredDiffs, StoredDimensionScores, StoredFlaggedItems } from './report.types.js';
import type { DoubleConsensusItem } from '../../engines/report/double-report.engine.js';

/**
 * 报告记录服务（report + visibility_log 两张表的唯一出口）
 *
 * 为什么把两张表圈在一个服务里：`visibility_log.report_id` 依赖 report 行的存在，
 * 且「谁在什么时候看了哪一层」必须与「报告是否已就绪」同源判断；
 * 分散到两个服务会让「先记日志再判断就绪」这类顺序错误无法在编译期发现。
 *
 * 规格依据：PRD-002 R3/R6；边界总表 D1（重试次数上限 3）；F4（越权记日志）
 */
@Injectable()
export class ReportRecordService {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reportRepository: Repository<ReportEntity>,
    @InjectRepository(VisibilityLogEntity)
    private readonly visibilityRepository: Repository<VisibilityLogEntity>,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  findByInviteId(inviteId: number): Promise<ReportEntity | null> {
    return this.reportRepository.findOne({ where: { inviteId } });
  }

  findById(reportId: number): Promise<ReportEntity | null> {
    return this.reportRepository.findOne({ where: { id: reportId } });
  }

  /** 批量取报告（历史列表用，避免 N+1） */
  listByInviteIds(inviteIds: number[]): Promise<ReportEntity[]> {
    if (inviteIds.length === 0) return Promise.resolve([]);
    return this.reportRepository.find({ where: { inviteId: In(inviteIds) } });
  }

  /**
   * 建「生成中」台账行（幂等）
   *
   * 为什么在入队时就落行而不是生成成功才落：R6 要求前端能轮询到 `status`，
   * 若首次生成就失败，没有行可轮询会退化成 404；同时 `uk_invite` 唯一键
   * 天然把「同一邀请重复入队」收敛成一行（worker 的幂等锚点）。
   *
   * NOT NULL 的三个 JSON 列先写空结构，避免 MySQL 严格模式拒绝插入。
   */
  async ensurePending(inviteId: number): Promise<ReportEntity> {
    const existing = await this.reportRepository.findOne({ where: { inviteId } });
    if (existing) return existing;

    try {
      return await this.reportRepository.save(
        this.reportRepository.create({
          inviteId,
          status: REPORT_STATUS.PENDING,
          retryCount: 0,
          dimensionScoresJson: { dimensions: [], unevaluated: [] } satisfies StoredDimensionScores,
          diffsJson: { rows: [], consensusCodes: [], pendingCodes: [] } satisfies StoredDiffs,
          flaggedItemsJson: { scale: [], choice: [] } satisfies StoredFlaggedItems,
          consensusJson: [],
          baselineTriggered: 0,
          templateVersionId: null,
          generatedAt: null,
        }),
      );
    } catch (error) {
      // 并发入队：唯一键冲突说明另一路已建行，回读即可（不视为失败）
      if (!isDuplicateKeyError(error)) throw error;
      const again = await this.reportRepository.findOne({ where: { inviteId } });
      if (!again) throw error;
      return again;
    }
  }

  /** 生成成功：写入全部结论并置 ready（同时失效本邀请的渲染缓存） */
  async markReady(input: {
    inviteId: number;
    dimensionScores: StoredDimensionScores;
    diffs: StoredDiffs;
    flagged: StoredFlaggedItems;
    consensus: DoubleConsensusItem[];
    baselineTriggered: boolean;
    templateVersionId: number | null;
  }): Promise<void> {
    await this.reportRepository.update(
      { inviteId: input.inviteId },
      {
        status: REPORT_STATUS.READY,
        dimensionScoresJson: input.dimensionScores,
        diffsJson: input.diffs,
        flaggedItemsJson: input.flagged,
        consensusJson: input.consensus,
        baselineTriggered: input.baselineTriggered ? 1 : 0,
        templateVersionId: input.templateVersionId,
        generatedAt: new Date(),
      },
    );
    await this.invalidateViewCache(input.inviteId);
  }

  /** 记录一次「会重试的失败」（状态仍为 pending，供前端展示生成中） */
  async markRetrying(inviteId: number, retryCount: number): Promise<void> {
    await this.reportRepository.update(
      { inviteId },
      { status: REPORT_STATUS.PENDING, retryCount },
    );
  }

  /** 末次失败：置 failed（D1，人工工单由 job_task 承载） */
  async markFailed(inviteId: number, retryCount: number): Promise<void> {
    await this.reportRepository.update(
      { inviteId },
      { status: REPORT_STATUS.FAILED, retryCount },
    );
  }

  /**
   * 可见性审计（R3 / F4）
   * 与审计日志同理：**写入失败不得阻断读报告**（审计是旁路），但必须留 error 日志便于补记。
   */
  async logVisibility(input: {
    reportId: number;
    viewerUid: number;
    level: VisibilityLevel;
    action: VisibilityAction;
    ip?: string | null;
  }): Promise<void> {
    try {
      await this.visibilityRepository.save(
        this.visibilityRepository.create({
          reportId: input.reportId,
          viewerUid: input.viewerUid,
          level: input.level,
          action: input.action,
          ip: input.ip ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `可见性审计写入失败（reportId=${input.reportId} viewer=${input.viewerUid} level=${input.level}）：` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'ReportRecordService',
      );
    }
  }

  /** 报告就绪后清缓存：模板/数据变更立即生效，不受 300 秒缓存拖累 */
  private async invalidateViewCache(inviteId: number): Promise<void> {
    await this.redis.delByPrefix(`${REPORT_VIEW_CACHE_PREFIX}${inviteId}:`);
  }
}
