import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  buildDoubleReportData,
  type DoubleParticipantSnapshot,
} from '../../engines/report/double-report.engine.js';
import type { AnswerMap, BaselineResult, QualityFlag } from '../../engines/scale/scale.types.js';
import { AccountService } from '../account/account.service.js';
import type { SheetScoresCache } from '../assessment/assessment.types.js';
import { ReportRecordService } from '../report/report-record.service.js';
import { REPORT_LEVEL, REPORT_STATUS } from '../report/report.constants.js';
import { ReportTemplateService } from '../report/report-template.service.js';
import type {
  StoredDiffs,
  StoredDimensionScores,
  StoredFlaggedItems,
} from '../report/report.types.js';
import { ScaleQueryService } from '../scale/scale-query.service.js';
import { AnswerSnapshotEntity } from './entities/answer-snapshot.entity.js';
import { InviteEntity } from './entities/invite.entity.js';
import {
  INVITE_STATUS,
  NICKNAME_FALLBACK,
  SNAPSHOT_ROLE_INITIATOR,
  SNAPSHOT_ROLE_INVITEE,
} from './invite.constants.js';

/** 快照缺少维度分缓存时的兜底质量标记（不参与渲染，仅避免类型空洞） */
const EMPTY_QUALITY: QualityFlag = { isLowQuality: false, reasons: [], durationSec: 0 };
/** 快照缺少底线结果时的兜底（未触发） */
const NO_BASELINE: BaselineResult = { triggered: false, triggeredCodes: [], message: '' };

/**
 * 双人对比报告生成编排（模块 5，R6 + 边界总表 D1）
 *
 * 为什么放在邀请域而不是报告域：生成所需的输入是「邀请 + 双方答案快照」，
 * 而报告域只承载「报告本身的落库与渲染」（report.module.ts 注释）。若把编排放进报告域，
 * 报告域就要反向 import 邀请实体，形成 invite ↔ report 双向依赖（违反 architecture.md §2 依赖规则 2）。
 *
 * 幂等（ADR-005 决策 4）：同一邀请重复入队或重试时，若报告已 ready 直接返回，绝不重算覆盖。
 * 失败处理：本服务**抛错**，由 worker 决定重试次数与末次失败的落库（职责分离，避免两处各记一套计数）。
 */
@Injectable()
export class DoubleReportGeneratorService {
  constructor(
    @InjectRepository(InviteEntity)
    private readonly inviteRepository: Repository<InviteEntity>,
    @InjectRepository(AnswerSnapshotEntity)
    private readonly snapshotRepository: Repository<AnswerSnapshotEntity>,
    private readonly scaleQuery: ScaleQueryService,
    private readonly reportRecord: ReportRecordService,
    private readonly reportTemplate: ReportTemplateService,
    private readonly account: AccountService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 生成（或确认已生成）某邀请的对比报告
   * @returns 'skipped' = 已就绪无需重算；'generated' = 本次生成成功
   */
  async generate(inviteId: number): Promise<'skipped' | 'generated'> {
    const existing = await this.reportRecord.findByInviteId(inviteId);
    if (existing?.status === REPORT_STATUS.READY) {
      await this.markInviteUnlocked(inviteId);
      this.logger.log(`报告已就绪，跳过重复生成：inviteId=${inviteId}`, 'DoubleReportGeneratorService');
      return 'skipped';
    }

    const invite = await this.inviteRepository.findOne({ where: { id: inviteId } });
    if (!invite) {
      // 邀请不存在属数据异常（报告只在邀请流程内入队）：抛错转人工工单，不静默成功
      throw new Error(`报告生成失败：邀请不存在 inviteId=${inviteId}`);
    }

    const snapshots = await this.snapshotRepository.find({ where: { inviteId } });
    const initiatorSnapshot = snapshots.find((row) => row.role === SNAPSHOT_ROLE_INITIATOR);
    const inviteeSnapshot = snapshots.find((row) => row.role === SNAPSHOT_ROLE_INVITEE);
    if (!initiatorSnapshot || !inviteeSnapshot) {
      throw new Error(
        `报告生成失败：双方快照不齐备 inviteId=${inviteId} ` +
          `已就绪角色=${snapshots.map((row) => row.role).join('、') || '无'}`,
      );
    }

    const bundle = await this.scaleQuery.loadBundle(invite.scaleVersionId, { includeOffline: true });
    if (!bundle.engineRule) {
      // 无计分规则 = 无法分级/算差值（部署事故）：与单人报告同口径 fail-closed
      throw new Error(
        `报告生成失败：量表版本 ${invite.scaleVersionId} 缺少生效中的计分规则`,
      );
    }

    // L1 模板存在性先于计算校验：模板缺失时算出结论也无处渲染，早失败可省一次重算
    const l1Template = await this.reportTemplate.findActiveDoubleTemplate({
      scaleVersionId: invite.scaleVersionId,
      level: REPORT_LEVEL.L1,
    });
    if (!l1Template) {
      throw new Error(
        `报告生成失败：量表版本 ${invite.scaleVersionId} 缺少生效中的 L1 双人报告模板（请执行 npm run report:seed）`,
      );
    }

    const nicknames = await this.account.findNicknames(
      invite.inviteeUid === null ? [invite.initiatorUid] : [invite.initiatorUid, invite.inviteeUid],
    );
    const data = buildDoubleReportData({
      questions: bundle.engineQuestions,
      dimensions: bundle.engineDimensions,
      initiator: this.toParticipant(
        initiatorSnapshot,
        nicknames.get(invite.initiatorUid) ?? null,
        NICKNAME_FALLBACK.INITIATOR,
      ),
      invitee: this.toParticipant(
        inviteeSnapshot,
        invite.inviteeUid === null ? null : nicknames.get(invite.inviteeUid) ?? null,
        NICKNAME_FALLBACK.INVITEE,
      ),
      rule: bundle.engineRule,
    });

    // 先建台账行再写结论：markReady 走 UPDATE，行不存在会「改 0 行」而不报错，
    // 那样会出现「任务标成功但报告永远 pending」的静默故障。
    await this.reportRecord.ensurePending(inviteId);
    await this.reportRecord.markReady({
      inviteId,
      dimensionScores: this.toStoredDimensionScores(data),
      diffs: this.toStoredDiffs(data),
      flagged: {
        scale: data.scaleDivergences,
        choice: data.choiceDivergences,
      } satisfies StoredFlaggedItems,
      consensus: data.consensusItems,
      baselineTriggered: data.baseline.triggered,
      templateVersionId: Number(l1Template.id),
    });
    await this.markInviteUnlocked(inviteId);

    this.logger.log(
      `对比报告生成完成：inviteId=${inviteId} 维度=${data.dimensions.length} ` +
        `待沟通=${data.pendingDimensions.length} 共识=${data.consensusItems.length} ` +
        `分歧=${data.scaleDivergences.length + data.choiceDivergences.length} ` +
        `底线触发=${data.baseline.triggered}`,
      'DoubleReportGeneratorService',
    );
    return 'generated';
  }

  /** 报告就绪 → 邀请进入 report_unlocked（仅从 completed 迁移，避免覆盖终态） */
  private async markInviteUnlocked(inviteId: number): Promise<void> {
    await this.inviteRepository.update(
      { id: inviteId, status: INVITE_STATUS.COMPLETED },
      { status: INVITE_STATUS.REPORT_UNLOCKED },
    );
  }

  /**
   * 快照 → 引擎参与方结构
   * 维度分只取「已评估」的行：未评估维度绝不进比对（ADR-005 决策 7），
   * 否则会把「拒绝授权」当成 0 分算出差值（与 ADR-004 决策 2 同一条红线）。
   */
  private toParticipant(
    snapshot: AnswerSnapshotEntity,
    nickname: string | null,
    fallback: string,
  ): DoubleParticipantSnapshot {
    const cache = snapshot.dimensionScoresJson as SheetScoresCache | null;
    if (!cache || !Array.isArray(cache.dimensions)) {
      // 快照是生成报告的唯一数据源，结构坏了必须暴露而不是猜（重试 → 失败 → 人工工单）
      throw new Error(
        `报告生成失败：答案快照维度分缓存结构异常 snapshotId=${snapshot.id} role=${snapshot.role}`,
      );
    }

    return {
      nickname: nickname?.trim() ? nickname.trim() : fallback,
      answers: (snapshot.answersJson ?? {}) as AnswerMap,
      dimensionScores: cache.dimensions
        .filter((row) => row.evaluated && typeof row.score === 'number')
        .map((row) => ({ dimensionCode: row.code, score: row.score as number })),
      skippedDimensions: Array.isArray(cache.skipped) ? cache.skipped : [],
      quality: cache.quality ?? EMPTY_QUALITY,
      baseline: cache.baseline ?? NO_BASELINE,
    };
  }

  private toStoredDimensionScores(data: {
    dimensions: Array<{
      dimensionCode: string;
      dimensionName: string;
      scoreA: number;
      scoreB: number;
      answeredCountA: number;
      answeredCountB: number;
      scoredCount: number;
    }>;
    unevaluatedDimensions: Array<{ dimensionCode: string; dimensionName: string }>;
  }): StoredDimensionScores {
    return {
      dimensions: data.dimensions.map((row) => ({
        dimensionCode: row.dimensionCode,
        dimensionName: row.dimensionName,
        scoreA: row.scoreA,
        scoreB: row.scoreB,
        // 作答完整度随分落库（ADR-013 决策 4）：报告一经生成即冻结，不随题库改版回溯变化
        answeredCountA: row.answeredCountA,
        answeredCountB: row.answeredCountB,
        scoredCount: row.scoredCount,
      })),
      unevaluated: data.unevaluatedDimensions,
    };
  }

  private toStoredDiffs(data: {
    dimensions: Array<{
      dimensionCode: string;
      dimensionName: string;
      gap: number;
      level: 'high' | 'mid' | 'low';
      levelLabel: string;
    }>;
    consensusDimensions: Array<{ dimensionCode: string }>;
    pendingDimensions: Array<{ dimensionCode: string }>;
  }): StoredDiffs {
    return {
      rows: data.dimensions.map((row) => ({
        dimensionCode: row.dimensionCode,
        dimensionName: row.dimensionName,
        gap: row.gap,
        level: row.level,
        levelLabel: row.levelLabel,
      })),
      consensusCodes: data.consensusDimensions.map((row) => row.dimensionCode),
      pendingCodes: data.pendingDimensions.map((row) => row.dimensionCode),
    };
  }
}
