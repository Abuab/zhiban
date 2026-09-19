import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { isDuplicateKeyError } from '../../common/utils/db-error.util.js';
import { BASELINE_NOTICE_MESSAGE, LOW_QUALITY_NOTICE_MESSAGE, SCALE_CODE_PRE } from '../../engines/scale/scale.constants.js';
import type { AnswerMap } from '../../engines/scale/scale.types.js';
import type { DoubleConsensusItem } from '../../engines/report/double-report.engine.js';
import type { WechatConfig } from '../../config/configuration.js';
import { AccountService } from '../account/account.service.js';
import { AssessmentService } from '../assessment/assessment.service.js';
import type {
  AssessmentDetail,
  ReusableSingleSheet,
  SheetScoresCache,
  SheetState,
} from '../assessment/assessment.types.js';
import type { SaveAnswersDto, SubmitAssessmentDto } from '../assessment/dto/save-answers.dto.js';
import {
  JOB_TYPE_REPORT_GENERATE,
  REPORT_GENERATE_ATTEMPTS,
  REPORT_GENERATE_BACKOFF_MS,
  REPORT_GENERATE_JOB_NAME,
  REPORT_GENERATE_QUEUE,
} from '../queue/queue.constants.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ReportRecordService } from '../report/report-record.service.js';
import { DoubleReportRenderService } from '../report/double-report-render.service.js';
import { ReportTemplateService } from '../report/report-template.service.js';
import { REPORT_LEVEL, REPORT_STATUS, REPORT_VIEW_CACHE_PREFIX, REPORT_VIEW_CACHE_TTL_SEC } from '../report/report.constants.js';
import type { RenderableTemplate, StoredDoubleReport, StoredDiffs, StoredDimensionScores, StoredFlaggedItems } from '../report/report.types.js';
import type { ReportLevel } from '../report/entities/report-template.entity.js';
import { ScaleQueryService } from '../scale/scale-query.service.js';
import { WechatService } from '../wechat/wechat.service.js';
import { AnswerSnapshotEntity, type SnapshotRole } from './entities/answer-snapshot.entity.js';
import { InviteEntity } from './entities/invite.entity.js';
import {
  ACTIVE_INVITE_STATUSES,
  ANSWERED_INVITE_STATUSES,
  DOUBLE_REPORT_TEMPLATE_MISSING_MESSAGE,
  EXPIRABLE_INVITE_STATUSES,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_CONSENT_TEXT,
  INVITE_CREATE_COOLDOWN_PREFIX,
  INVITE_CREATE_COOLDOWN_SEC,
  INVITE_CODE_BYTES,
  INVITE_CODE_MAX_ATTEMPTS,
  INVITE_CODE_PATTERN,
  INVITE_EXPIRE_DAYS,
  INVITE_LIST_LIMIT,
  INVITE_NO_REUSABLE_SHEET_MESSAGE,
  INVITE_REMIND_MAX,
  INVITE_RENEW_DAYS,
  INVITE_RENEW_MAX,
  INVITE_REPLACEMENT_MAX,
  INVITE_REPORT_FAILED_MESSAGE,
  INVITE_REPORT_PENDING_MESSAGE,
  INVITE_STATUS,
  NICKNAME_FALLBACK,
  REMINDABLE_INVITE_STATUSES,
  REMIND_TEMPLATE_FIELDS,
  REMIND_TEMPLATE_MISSING_MESSAGE,
  REPORT_JOB_ID_PREFIX,
  REQUIRED_SNAPSHOT_COUNT,
  SHARE_WATERMARK_LENGTH,
  SHARE_WATERMARK_NAMESPACE,
  SNAPSHOT_ROLE_INITIATOR,
  SNAPSHOT_ROLE_INVITEE,
} from './invite.constants.js';
import type {
  DoubleReportL3Material,
  InviteCreateResult,
  InviteInitiatorView,
  InviteInviteeView,
  InviteListItem,
  InviteProgressAck,
  InviteRemindResult,
  InviteReportView,
  InviteRole,
  InviteView,
  ReadyDoubleReportSource,
  ReportGenerateJob,
} from './invite.types.js';
import type { CreateInviteDto, InviteConsentDto, ShareMaterialDto } from './dto/invite.dto.js';

/** 一天的毫秒数（过期/续期时间计算用） */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 订阅消息 thing 类型字段上限（微信侧限制 20 个字符，超长整条消息会被拒） */
const REMIND_INVITER_MAX_CHARS = 20;

/** 报告 JSON 列为空时的兜底结构（结构坏掉时渲染出空报告，而不是抛错把页面打死） */
const EMPTY_DIMENSION_SCORES: StoredDimensionScores = { dimensions: [], unevaluated: [] };
const EMPTY_DIFFS: StoredDiffs = { rows: [], consensusCodes: [], pendingCodes: [] };
const EMPTY_FLAGGED: StoredFlaggedItems = { scale: [], choice: [] };

/**
 * 双人邀请服务（模块 5，规格 PRD-002）
 *
 * 覆盖：状态机（C1/C3/C4/C7/cancelled）、三层可见性取数（R3）、答案快照冻结（B8）、
 *      提醒（§5，C9）、限流与冷却（C8）、越权防护（F4 + ADR-005 决策 1）
 *
 * 安全自查（铁律 #6「恶意用户会怎么攻击这里」）：
 *   1. **越权**：所有 :code/:id 接口先判参与方；非参与方与「邀请不存在」返回同一错误（404），
 *      不留「这个 id 存在」的枚举 oracle（ADR-005 决策 1、ADR-004 决策 6）。
 *   2. **抢绑**：C1 的「首个完成授权登录者绑定」用 `invitee_uid IS NULL` 作 CAS 条件做条件更新，
 *      并发打开同一链接时只有一次能成功，其余拿「该邀请已被接受」。
 *   3. **刷邀请码**：创建走 Redis 滑动窗口冷却 + 全局按 openid 限流；邀请码为 128 位随机（不可枚举）。
 *   4. **刷提醒**：次数上限在发送**成功之后**才落库（ADR-005 决策 6），
 *      未送达不扣次数也不会被用来无限轰炸对方（微信侧同样有频控兜底）。
 *   5. **偷看答案**：邀请域任何出口都不返回对方原始答卷；分歧题仅在 L1（规范增补 v0.2 §3.1 授予发起方）。
 *   6. **伪造完成**：交卷一律走 AssessmentService（服务端按锁定版本的题目定义净化和校验完整性），
 *      客户端无法直接写 answer_snapshot。
 */
@Injectable()
export class InviteService {
  constructor(
    @InjectRepository(InviteEntity)
    private readonly inviteRepository: Repository<InviteEntity>,
    @InjectRepository(AnswerSnapshotEntity)
    private readonly snapshotRepository: Repository<AnswerSnapshotEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly assessment: AssessmentService,
    private readonly scaleQuery: ScaleQueryService,
    private readonly reportRecord: ReportRecordService,
    private readonly reportTemplate: ReportTemplateService,
    private readonly render: DoubleReportRenderService,
    private readonly account: AccountService,
    private readonly wechat: WechatService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly jobs: JobTaskService,
    private readonly logger: AppLogger,
    @InjectQueue(REPORT_GENERATE_QUEUE)
    private readonly reportQueue: Queue<ReportGenerateJob>,
  ) {}

  // ------------------------------------------------------------------ 发起方

  /**
   * 创建邀请（PRD-002 §7 POST /invites；P1 免费，无支付节点）
   *
   * 前置（ADR-005 决策 7）：① 发起方已完成**同版本**单人测评（其答案即双人对比的 A 端）
   *                        ② 当前没有进行中的邀请（PRD-002 §5 防囤积）
   */
  async create(userId: number, dto: CreateInviteDto): Promise<InviteCreateResult> {
    const scaleCode = dto.scaleCode?.trim() ? dto.scaleCode.trim() : SCALE_CODE_PRE;
    const version = await this.scaleQuery.findActiveVersionByScaleCode(scaleCode);
    if (!version) {
      throw new BusinessException(
        ErrorCode.SCALE_NOT_FOUND,
        `量表 ${scaleCode} 没有生效版本，暂时无法发起双人测评`,
      );
    }

    await this.assertCreateCooldown(userId);
    const initiatorSheet = await this.requireInitiatorSheet(userId, Number(version.id));
    await this.assertNoActiveInvite(userId);

    const invite = await this.createInviteWithSnapshot({
      initiatorUid: userId,
      scaleVersionId: Number(version.id),
      replacedFromInviteId: null,
      initiatorSheet,
    });

    this.logger.log(
      `创建双人邀请：inviteId=${invite.id} 发起方=${userId} 量表版本=${version.id} ` +
        `过期时间=${invite.expireAt.toISOString()}`,
      'InviteService',
    );
    return this.toCreateResult(invite, version.version);
  }

  /** 换人重邀（C7：仅 declined 且该条未派生过新邀请，全流程限 1 次） */
  async replace(userId: number, inviteId: number): Promise<InviteCreateResult> {
    const original = await this.requireInitiatorById(userId, inviteId, 'replace');
    if (original.status !== INVITE_STATUS.DECLINED) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '仅对方拒绝同意后才可换人重邀');
    }

    const derived = await this.inviteRepository.count({
      where: { replacedFromInviteId: original.id },
    });
    if (derived >= INVITE_REPLACEMENT_MAX) {
      throw new BusinessException(
        ErrorCode.INVITE_STATUS_INVALID,
        `换人次数已用完（上限 ${INVITE_REPLACEMENT_MAX} 次）`,
      );
    }

    await this.assertCreateCooldown(userId);
    // 量表版本沿用原邀请：换人只换被邀请方，量表快照不应漂移（B8）
    const initiatorSheet = await this.requireInitiatorSheet(userId, Number(original.scaleVersionId));
    await this.assertNoActiveInvite(userId);

    const invite = await this.createInviteWithSnapshot({
      initiatorUid: userId,
      scaleVersionId: Number(original.scaleVersionId),
      replacedFromInviteId: Number(original.id),
      initiatorSheet,
    });
    const version = await this.scaleQuery.getVersionOrFail(Number(original.scaleVersionId));

    this.logger.log(
      `换人重邀：原邀请=${original.id} 新邀请=${invite.id} 发起方=${userId}`,
      'InviteService',
    );
    return this.toCreateResult(invite, version.version);
  }

  /**
   * 续期（C4：可续期 7 天一次）
   *
   * 规格原文把续期写在 expired 分支下（「30 天未 completed → expired（不退款，可续期 7 天一次）」），
   * 故**未过期与已过期都可续期**；过期后续期需把状态复活到进行中，
   * 复活目标按「对方是否已开始作答」推定（已开始 → answering，仅打开过 → invite_opened，没打开过 → invite_created），
   * 这样对方已填的答案与同意状态都不会丢（答题卷是独立于 invite 状态存在的）。
   */
  async renew(userId: number, inviteId: number): Promise<InviteInitiatorView> {
    const invite = await this.requireInitiatorById(userId, inviteId, 'renew');
    if (
      !EXPIRABLE_INVITE_STATUSES.includes(invite.status) &&
      invite.status !== INVITE_STATUS.EXPIRED
    ) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '当前状态无法续期');
    }
    if (invite.renewedCount >= INVITE_RENEW_MAX) {
      throw new BusinessException(
        ErrorCode.INVITE_STATUS_INVALID,
        `续期次数已用完（上限 ${INVITE_RENEW_MAX} 次）`,
      );
    }

    const base = Math.max(Date.now(), invite.expireAt.getTime());
    const expireAt = new Date(base + INVITE_RENEW_DAYS * DAY_MS);
    const revivedStatus =
      invite.status === INVITE_STATUS.EXPIRED
        ? await this.resolveRevivedStatus(invite)
        : invite.status;

    await this.inviteRepository.update(
      { id: invite.id },
      { renewedCount: invite.renewedCount + 1, expireAt, status: revivedStatus },
    );
    invite.renewedCount += 1;
    invite.expireAt = expireAt;
    invite.status = revivedStatus;

    this.logger.log(
      `邀请续期：inviteId=${invite.id} 新过期时间=${expireAt.toISOString()} ` +
        `状态=${revivedStatus} 已续期=${invite.renewedCount} 次`,
      'InviteService',
    );
    return this.buildInitiatorView(invite, new Map());
  }

  /** 取消邀请（§3 异常分支 cancelled；已完成/已解锁不允许取消，避免把已生成的报告孤儿化） */
  async cancel(userId: number, inviteId: number): Promise<InviteInitiatorView> {
    const invite = await this.requireInitiatorById(userId, inviteId, 'cancel');
    if (!ACTIVE_INVITE_STATUSES.includes(invite.status)) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '当前状态无法取消');
    }

    await this.inviteRepository.update(
      { id: invite.id, status: In([...ACTIVE_INVITE_STATUSES]) },
      { status: INVITE_STATUS.CANCELLED, cancelledAt: new Date() },
    );
    invite.status = INVITE_STATUS.CANCELLED;
    invite.cancelledAt = new Date();

    this.logger.log(`邀请已取消：inviteId=${invite.id} 发起方=${userId}`, 'InviteService');
    return this.buildInitiatorView(invite, new Map());
  }

  /**
   * 提醒 TA（§5「每邀请限 3 次」/ C9）
   *
   * ADR-005 决策 6：**未送达不消耗次数**。微信侧未订阅（errcode 43101）是正常业务结果，
   * 若照扣次数，发起方三次机会可能一次都没真正送达，这与「限 3 次」的产品意图相悖。
   */
  async remind(userId: number, inviteId: number): Promise<InviteRemindResult> {
    const invite = await this.requireInitiatorById(userId, inviteId, 'remind');
    if (!REMINDABLE_INVITE_STATUSES.includes(invite.status)) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '当前状态无需提醒');
    }
    if (invite.remindCount >= INVITE_REMIND_MAX) {
      throw new BusinessException(
        ErrorCode.INVITE_STATUS_INVALID,
        `提醒次数已用完（上限 ${INVITE_REMIND_MAX} 次）`,
      );
    }
    if (invite.inviteeUid === null) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '对方还没有打开邀请，暂时无法提醒');
    }

    const wechat = this.config.get<WechatConfig>('wechat') as WechatConfig;
    const templateId = this.remindTemplateId();
    if (!templateId) {
      // 模板属运营配置（微信公众平台创建后填入 env），未配置时功能不可用但不消耗次数
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, REMIND_TEMPLATE_MISSING_MESSAGE);
    }

    const target = await this.account.findNotifyTarget(Number(invite.inviteeUid));
    if (!target) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '对方账号状态异常，暂时无法提醒');
    }

    const nicknames = await this.account.findNicknames([Number(invite.initiatorUid)]);
    const now = new Date();
    const sendResult = await this.wechat.sendSubscribeMessage({
      openid: target.openid,
      templateId,
      page: wechat.subscribeInvitePage ? wechat.subscribeInvitePage : undefined,
      data: {
        [REMIND_TEMPLATE_FIELDS.INVITER]: {
          value: this.truncateChars(
            nicknames.get(Number(invite.initiatorUid)) ?? NICKNAME_FALLBACK.INITIATOR,
            REMIND_INVITER_MAX_CHARS,
          ),
        },
        [REMIND_TEMPLATE_FIELDS.TIME]: { value: this.formatDateTime(now) },
      },
    });

    if (!sendResult.delivered) {
      this.logger.warn(
        `提醒未送达，不消耗次数：inviteId=${invite.id} 原因=${sendResult.reason}`,
        'InviteService',
      );
      throw new BusinessException(ErrorCode.WX_API_ERROR, '提醒发送失败，请稍后再试');
    }

    const remindCount = invite.remindCount + 1;
    await this.inviteRepository.update({ id: invite.id }, { remindCount, remindAt: now });
    this.logger.log(
      `提醒已发送：inviteId=${invite.id} 已用 ${remindCount}/${INVITE_REMIND_MAX} 次`,
      'InviteService',
    );

    return {
      inviteId: Number(invite.id),
      remindCount,
      remindRemaining: Math.max(0, INVITE_REMIND_MAX - remindCount),
      remindAt: now.toISOString(),
    };
  }

  /** 我的邀请列表（§5：历史报告永久可回看） */
  async listMine(userId: number): Promise<InviteListItem[]> {
    const invites = await this.inviteRepository.find({
      where: [{ initiatorUid: userId }, { inviteeUid: userId }],
      order: { id: 'DESC' },
      take: INVITE_LIST_LIMIT,
    });
    if (invites.length === 0) return [];

    const versionCache = new Map<number, string>();
    const reports = await this.reportRecord.listByInviteIds(invites.map((invite) => Number(invite.id)));
    const reportByInviteId = new Map(reports.map((report) => [Number(report.inviteId), report]));

    const counterpartIds = invites
      .map((invite) =>
        Number(invite.initiatorUid) === Number(userId) ? invite.inviteeUid : invite.initiatorUid,
      )
      .filter((id): id is number => id !== null);
    const nicknames = await this.account.findNicknames(counterpartIds);

    const items: InviteListItem[] = [];
    for (const invite of invites) {
      const role: InviteRole =
        Number(invite.initiatorUid) === Number(userId) ? 'initiator' : 'invitee';
      const counterpartId =
        role === 'initiator' ? invite.inviteeUid : Number(invite.initiatorUid);
      const report = reportByInviteId.get(Number(invite.id));

      items.push({
        inviteId: Number(invite.id),
        code: invite.code,
        role,
        status: invite.status,
        scaleVersion: await this.versionString(Number(invite.scaleVersionId), versionCache),
        counterpartNickname: counterpartId === null ? null : nicknames.get(counterpartId) ?? null,
        createdAt: invite.createdAt.toISOString(),
        expireAt: invite.expireAt.toISOString(),
        completedAt: invite.completedAt ? invite.completedAt.toISOString() : null,
        reportStatus: report ? report.status : null,
        reportId: report && report.status === REPORT_STATUS.READY ? Number(report.id) : null,
      });
    }
    return items;
  }

  /**
   * 取用户**最近一份报告已就绪**的双人测评取数快照（模块 7 专属卡双人版，ADR-008 决策 5）
   *
   * 口径说明：
   *   - 用户既可能是发起方也可能是被邀请方；但 `initiatorUid` 恒取**发起方**
   *     —— 同一邀请只生成一张专属卡、双方共享，卡归属发起方（ADR-008 决策 5）。
   *   - 只取 `report.status = ready` 的最新一份：生成中 / 生成失败的邀请不能作为输入，
   *     否则 prompt 里会落进空维度表（宁可降级为单人版，见 ADR-007 决策 4）。
   *   - 只读 `dimension_scores_json` + `flagged_items_json`（选维度、选分歧题所需），
   *     不下发 diffs / 共识区 / 底线提示 —— 与专属卡无关，少读即少暴露（privacy by design）。
   *   - 无已就绪报告时返回 null，由调用方降级处理。
   */
  async findLatestReadyDoubleReport(userId: number): Promise<ReadyDoubleReportSource | null> {
    const invites = await this.inviteRepository.find({
      where: [{ initiatorUid: userId }, { inviteeUid: userId }],
      order: { id: 'DESC' },
      take: INVITE_LIST_LIMIT,
    });
    if (invites.length === 0) return null;

    // 一次批量取报告避免 N+1；invites 已按 id 倒序，故首个命中的就是「最近一份」
    const reports = await this.reportRecord.listByInviteIds(
      invites.map((invite) => Number(invite.id)),
    );
    const reportByInviteId = new Map(reports.map((report) => [Number(report.inviteId), report]));

    for (const invite of invites) {
      const report = reportByInviteId.get(Number(invite.id));
      if (!report || report.status !== REPORT_STATUS.READY) continue;
      // 被邀请方未绑定 = 报告不可能就绪；防御性跳过（避免把 null 当 uid 下发）
      if (invite.inviteeUid === null) continue;

      return {
        inviteId: Number(invite.id),
        initiatorUid: Number(invite.initiatorUid),
        inviteeUid: Number(invite.inviteeUid),
        scaleVersionId: Number(invite.scaleVersionId),
        dimensionScores:
          (report.dimensionScoresJson as StoredDimensionScores | null) ?? EMPTY_DIMENSION_SCORES,
        flagged: (report.flaggedItemsJson as StoredFlaggedItems | null) ?? EMPTY_FLAGGED,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------- 被邀请方

  /**
   * 进入邀请（PRD-002 §7 GET /invites/:code）
   *
   * C1：邀请码绑定**第一个完成授权登录的人**；第三人打开只得到「该邀请已被接受」，
   * 不泄露发起方信息、不泄露是否有人答过、不泄露任何答题数据。
   */
  async open(userId: number, code: string): Promise<InviteView> {
    const invite = await this.loadByCode(code);
    this.assertOpenable(invite);

    // 发起方打开自己的链接：直接给发起方视角，且**不占用**被邀请方名额
    if (Number(invite.initiatorUid) === Number(userId)) {
      return this.buildInitiatorView(invite, new Map());
    }
    if (invite.inviteeUid === null) {
      const bound = await this.bindFirstInvitee(invite, userId);
      if (!bound) {
        // 并发打开时败者：与“已被他人绑定”同一提示，不透露是谁先到的
        throw new BusinessException(ErrorCode.INVITE_ALREADY_ACCEPTED, INVITE_ALREADY_ACCEPTED_MESSAGE);
      }
      this.logger.log(`邀请已绑定被邀请方：inviteId=${invite.id}`, 'InviteService');
      return this.buildInviteeView(invite, userId, new Map());
    }
    if (Number(invite.inviteeUid) === Number(userId)) {
      return this.buildInviteeView(invite, userId, new Map());
    }
    throw new BusinessException(ErrorCode.INVITE_ALREADY_ACCEPTED, INVITE_ALREADY_ACCEPTED_MESSAGE);
  }

  /** 知情同意（R8 强制勾选；agreed=false 即 declined，C7） */
  async consent(userId: number, code: string, dto: InviteConsentDto): Promise<InviteView> {
    const invite = await this.loadByCode(code);
    this.assertOpenable(invite);
    const role = await this.requireParticipant(invite, userId, 'consent');
    if (role !== 'invitee') {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '知情同意由被邀请方确认');
    }

    if (dto.agreed) {
      if (invite.status === INVITE_STATUS.OPENED) {
        await this.inviteRepository.update(
          { id: invite.id, status: INVITE_STATUS.OPENED },
          { status: INVITE_STATUS.CONSENT_GIVEN },
        );
        invite.status = INVITE_STATUS.CONSENT_GIVEN;
        this.logger.log(
          `被邀请方已同意知情同意（R8）：inviteId=${invite.id} 文案版本=${INVITE_CONSENT_TEXT.length}`,
          'InviteService',
        );
      } else if (!ANSWERED_INVITE_STATUSES.includes(invite.status)) {
        // 重复点击同意走幂等返回（多端/网络重试），其余状态一律拒绝
        throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID);
      }
    } else {
      if (invite.status !== INVITE_STATUS.OPENED) {
        throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '当前状态无法拒绝同意');
      }
      await this.inviteRepository.update(
        { id: invite.id, status: INVITE_STATUS.OPENED },
        { status: INVITE_STATUS.DECLINED, declinedAt: new Date() },
      );
      invite.status = INVITE_STATUS.DECLINED;
      invite.declinedAt = new Date();
      this.logger.log(
        `被邀请方拒绝知情同意：inviteId=${invite.id}（发起方可换人重邀 1 次，C7）`,
        'InviteService',
      );
    }

    return this.buildInviteeView(invite, userId, new Map());
  }

  /** 打开/续答邀请答卷（先建卷再渲染，客户端进入答题页前调用；幂等） */
  async openSheet(userId: number, code: string): Promise<AssessmentDetail> {
    const invite = await this.loadByCode(code);
    const role = await this.requireParticipant(invite, userId, 'openSheet');
    if (role !== 'invitee') {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '答题由被邀请方完成');
    }
    this.assertAnswerable(invite);
    return this.assessment.openInviteSheet(userId, Number(invite.id), Number(invite.scaleVersionId));
  }

  /** 保存邀请答题草稿（B1 断点续答 / A3 乐观锁） */
  async saveDraft(userId: number, code: string, dto: SaveAnswersDto): Promise<SheetState> {
    const invite = await this.loadByCode(code);
    const role = await this.requireParticipant(invite, userId, 'saveDraft');
    if (role !== 'invitee') {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '答题由被邀请方完成');
    }
    this.assertAnswerable(invite);

    // 首次保存草稿即进入 answering（状态机 consent_given → answering）。
    // 放在保存之后判定，避免「打开了答题页但一题没答」就把状态推走。
    if (invite.status === INVITE_STATUS.CONSENT_GIVEN) {
      await this.inviteRepository.update(
        { id: invite.id, status: INVITE_STATUS.CONSENT_GIVEN },
        { status: INVITE_STATUS.ANSWERING },
      );
      invite.status = INVITE_STATUS.ANSWERING;
    }
    return this.assessment.saveInviteDraft(userId, Number(invite.id), dto);
  }

  /**
   * 交卷（B5 锁定答案）→ 冻结被邀请方快照 → 双方齐备则入队生成报告（R6）
   */
  async submit(
    userId: number,
    code: string,
    dto: SubmitAssessmentDto,
  ): Promise<InviteProgressAck> {
    const invite = await this.loadByCode(code);
    const role = await this.requireParticipant(invite, userId, 'submit');
    if (role !== 'invitee') {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '答题由被邀请方完成');
    }
    this.assertAnswerable(invite);

    const result = await this.assessment.submitInvite(userId, Number(invite.id), dto);
    await this.upsertSnapshot({
      inviteId: Number(invite.id),
      userId,
      role: SNAPSHOT_ROLE_INVITEE,
      scaleVersionId: Number(invite.scaleVersionId),
      answers: result.answers as AnswerMap,
      cache: result.cache,
      qualityFlag: result.qualityFlag,
      durationSec: result.durationSec,
      completedAt: new Date(),
      isReuse: false,
    });

    this.logger.log(
      `被邀请方已交卷：inviteId=${invite.id} sheetId=${result.sheetId} ` +
        `质量=${result.qualityFlag === null ? 'ok' : result.qualityFlag} ` +
        `底线触发=${result.cache.baseline.triggered}`,
      'InviteService',
    );
    return this.finishInviteeSide(invite);
  }

  /**
   * 复用历史单人答案（C3 / R7）
   *
   * 语义裁决：复用 = **以历史答案作为本次双人作答并直接完成**（等同交卷），
   * 依据是 R7 的「复用答案时，快照标注复用，**报告正常生成**」——
   * 若复用只是把答案预填进答题页，报告不可能生成，该句就无从成立。
   * 复用需本人显式确认（本接口即确认动作），不提供「替对方决定」的路径。
   */
  async reuse(userId: number, code: string): Promise<InviteProgressAck> {
    const invite = await this.loadByCode(code);
    const role = await this.requireParticipant(invite, userId, 'reuse');
    if (role !== 'invitee') {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '答题由被邀请方完成');
    }
    this.assertAnswerable(invite);
    if (invite.reuseAllowed !== 1) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '本次邀请不允许复用历史答案');
    }

    const reusable = await this.assessment.findReusableSingleSheet(
      userId,
      Number(invite.scaleVersionId),
    );
    if (!reusable) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, INVITE_NO_REUSABLE_SHEET_MESSAGE);
    }

    await this.upsertSnapshot({
      inviteId: Number(invite.id),
      userId,
      role: SNAPSHOT_ROLE_INVITEE,
      scaleVersionId: Number(invite.scaleVersionId),
      answers: reusable.answers as AnswerMap,
      cache: reusable.cache,
      qualityFlag: reusable.qualityFlag,
      durationSec: reusable.durationSec,
      completedAt: new Date(),
      isReuse: true,
    });

    this.logger.log(
      `被邀请方复用历史答案：inviteId=${invite.id} 来源答卷=${reusable.sheetId}（R7 快照标注 is_reuse=1）`,
      'InviteService',
    );
    return this.finishInviteeSide(invite);
  }

  // ------------------------------------------------------------------ 报告

  /**
   * 读取对比报告（R3 三层可见：发起方 L1 / 被邀请方 L2；R6 未就绪时返回 pending 供轮询）
   *
   * 裁剪发生在**服务端渲染前**（不是前端过滤）：L2 的渲染上下文里根本没有分值/差值，
   * 即便模板误写占位符也渲染不出内容（DoubleReportRenderService 的双保险）。
   */
  async getReport(userId: number, code: string): Promise<InviteReportView> {
    const invite = await this.loadByCode(code);
    const role = await this.requireParticipant(invite, userId, 'getReport');
    const level: ReportLevel = role === 'initiator' ? REPORT_LEVEL.L1 : REPORT_LEVEL.L2;

    const report = await this.reportRecord.findByInviteId(Number(invite.id));
    if (!report || report.status !== REPORT_STATUS.READY) {
      if (
        !report &&
        !ANSWERED_INVITE_STATUSES.includes(invite.status)
      ) {
        throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '还没有可查看的报告');
      }
      return {
        reportId: report ? Number(report.id) : null,
        level,
        status: report ? report.status : REPORT_STATUS.PENDING,
        message:
          report && report.status === REPORT_STATUS.FAILED
            ? INVITE_REPORT_FAILED_MESSAGE
            : INVITE_REPORT_PENDING_MESSAGE,
      };
    }

    // 缓存只按 (inviteId, level) 维度：L1 恒为发起方视角、L2 恒为被邀请方视角，不会串视角
    const cacheKey = `${REPORT_VIEW_CACHE_PREFIX}${invite.id}:${level}`;
    const cached = await this.redis.getJson<InviteReportView>(cacheKey);
    if (cached) {
      await this.reportRecord.logVisibility({
        reportId: Number(report.id),
        viewerUid: userId,
        level,
        action: 'view',
      });
      return cached;
    }

    const view = await this.renderView(invite, role);
    await this.redis.setJson(cacheKey, view, REPORT_VIEW_CACHE_TTL_SEC);
    await this.reportRecord.logVisibility({
      reportId: Number(report.id),
      viewerUid: userId,
      level,
      action: 'view',
    });
    return view;
  }

  /**
   * 生成 L3 分享版长图**素材**（架构 §3.2；ADR-005 决策 4：P1 无对象存储，端上 canvas 合成）
   * 只有发起方可生成；内容为模板固定的三个正向区块，可勾选范围仅共识项（默认全量）。
   */
  async getShareMaterial(
    userId: number,
    reportId: number,
    dto: ShareMaterialDto,
  ): Promise<DoubleReportL3Material> {
    const report = await this.reportRecord.findById(reportId);
    if (!report) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '报告不存在');
    }
    const invite = await this.inviteRepository.findOne({ where: { id: Number(report.inviteId) } });
    if (!invite) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '报告不存在');
    }
    const role = await this.requireParticipant(invite, userId, 'getShareMaterial');
    if (role !== 'initiator') {
      // 非发起方（含被邀请方）一律与「不存在」同一响应，不暴露存在性（ADR-005 决策 1）
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '报告不存在');
    }
    if (report.status !== REPORT_STATUS.READY) {
      throw new BusinessException(ErrorCode.REPORT_NOT_READY);
    }

    const level = REPORT_LEVEL.L3;
    const frozenTemplateId = null; // ADR-005 决策 5：L2/L3 不逐报告冻结模板
    const loaded = await this.reportTemplate.loadDoubleTemplate({
      scaleVersionId: Number(invite.scaleVersionId),
      level,
      frozenTemplateId,
    });
    if (!loaded) {
      this.logger.error(
        `双人报告模板缺失：scaleVersionId=${invite.scaleVersionId} level=${level}，请执行 npm run report:seed`,
        undefined,
        'InviteService',
      );
      throw new BusinessException(ErrorCode.REPORT_NOT_READY, DOUBLE_REPORT_TEMPLATE_MISSING_MESSAGE);
    }

    const nicknames = await this.loadNicknames(invite);
    const renderedAt = new Date();
    const rendered = this.render.render({
      level,
      template: this.toRenderableTemplate(loaded),
      data: this.toStoredDoubleReport(report),
      nicknames,
      scaleVersion: await this.versionString(Number(invite.scaleVersionId), new Map()),
      baselineTriggered: report.baselineTriggered === 1,
      lowQuality: false, // L3 不含质量提示区块，给 false 让该块整体不出现
      renderedAt,
      shareConsensusCodes: dto.selectedBlocks ?? [],
    });

    await this.reportRecord.logVisibility({
      reportId: Number(report.id),
      viewerUid: userId,
      level,
      action: 'share_image_created',
    });

    const titleBlock = rendered.blocks.find((block) => block.blockKey === 'SHARE_TITLE');
    return {
      reportId: Number(report.id),
      level: 'L3',
      title: titleBlock ? titleBlock.text : '',
      nicknames,
      date: this.formatDate(renderedAt),
      blocks: rendered.blocks,
      // 水印 = user_id 哈希（D3 溯源）：端上只负责绘制，无法伪造
      watermark: createHash('sha256')
        .update(`${SHARE_WATERMARK_NAMESPACE}${userId}`)
        .digest('hex')
        .slice(0, SHARE_WATERMARK_LENGTH),
      disclaimer: rendered.disclaimer,
    };
  }

  // ------------------------------------------------------------ 状态机内部

  /** 取可续期时的复活状态（未绑定 → created；已绑定未作答 → opened；已建卷 → answering） */
  private async resolveRevivedStatus(invite: InviteEntity): Promise<InviteEntity['status']> {
    if (invite.inviteeUid === null) return INVITE_STATUS.CREATED;
    const detail = await this.assessment.getInviteDetail(Number(invite.inviteeUid), Number(invite.id));
    return detail ? INVITE_STATUS.ANSWERING : INVITE_STATUS.OPENED;
  }

  /**
   * 提醒订阅消息模板 id（未配置返回 null）
   * 端上用它调 `wx.requestSubscribeMessage`，属「结构性标识」而非运营文案，故由配置统一下发。
   */
  private remindTemplateId(): string | null {
    const wechat = this.config.get<WechatConfig>('wechat') as WechatConfig;
    return wechat.subscribeTemplateInvite ? wechat.subscribeTemplateInvite : null;
  }

  /** 被邀请方侧收尾：状态置 completed 并按需入队生成报告（R6） */
  private async finishInviteeSide(invite: InviteEntity): Promise<InviteProgressAck> {
    if (!ANSWERED_INVITE_STATUSES.includes(invite.status)) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '请先完成知情同意再作答');
    }
    if (
      invite.status !== INVITE_STATUS.COMPLETED &&
      invite.status !== INVITE_STATUS.REPORT_UNLOCKED
    ) {
      const completedAt = new Date();
      await this.inviteRepository.update(
        { id: invite.id, status: In([INVITE_STATUS.CONSENT_GIVEN, INVITE_STATUS.ANSWERING]) },
        { status: INVITE_STATUS.COMPLETED, completedAt },
      );
      invite.status = INVITE_STATUS.COMPLETED;
      invite.completedAt = completedAt;
    }

    const bothCompleted = await this.enqueueReportIfReady(invite);
    const report = await this.reportRecord.findByInviteId(Number(invite.id));
    return {
      inviteId: Number(invite.id),
      status: invite.status,
      reportStatus: report ? report.status : null,
      bothCompleted,
    };
  }

  /**
   * 双方快照齐备则入队生成报告（R6）
   * 幂等：`report.uk_invite` 把并发入队收敛成一行；`jobId = report-<inviteId>` 把重复入队收敛成一个任务；
   * Worker 内还会再查一次 `status='ready'`，三重保证「重算不覆盖已生成的报告」。
   */
  private async enqueueReportIfReady(invite: InviteEntity): Promise<boolean> {
    const snapshots = await this.snapshotRepository.find({ where: { inviteId: invite.id } });
    if (snapshots.length < REQUIRED_SNAPSHOT_COUNT) return false;

    await this.reportRecord.ensurePending(Number(invite.id));
    await this.jobs.open(JOB_TYPE_REPORT_GENERATE, String(invite.id));
    await this.reportQueue.add(
      REPORT_GENERATE_JOB_NAME,
      { inviteId: Number(invite.id) } satisfies ReportGenerateJob,
      {
        jobId: `${REPORT_JOB_ID_PREFIX}${invite.id}`,
        attempts: REPORT_GENERATE_ATTEMPTS,
        backoff: { type: 'exponential', delay: REPORT_GENERATE_BACKOFF_MS },
        // 完成即移除：同一 inviteId 的 jobId 之后仍可复用（重试由 attempts 承担，不靠残留 job）
        removeOnComplete: true,
        // 失败也移除：失败事实以 job_task + report.status='failed' 为准（后台可查，不依赖 Redis 残留）
        removeOnFail: true,
      },
    );
    this.logger.log(
      `报告生成任务已入队：inviteId=${invite.id} 快照数=${snapshots.length}`,
      'InviteService',
    );
    return true;
  }

  /** 冻结一份答案快照（B8 不可变；uk_invite_user 保证每人一份，重入幂等） */
  private async upsertSnapshot(input: {
    inviteId: number;
    userId: number;
    role: SnapshotRole;
    scaleVersionId: number;
    answers: AnswerMap;
    cache: SheetScoresCache;
    qualityFlag: string | null;
    durationSec: number | null;
    completedAt: Date;
    isReuse: boolean;
  }): Promise<void> {
    const payload = {
      answersJson: input.answers,
      dimensionScoresJson: input.cache,
      qualityFlag: input.qualityFlag,
      baselineTriggered: input.cache.baseline.triggered ? 1 : 0,
      isReuse: input.isReuse ? 1 : 0,
      durationSec: input.durationSec,
      completedAt: input.completedAt,
    };

    const existing = await this.snapshotRepository.findOne({
      where: { inviteId: input.inviteId, userId: input.userId },
    });
    if (existing) {
      await this.snapshotRepository.update(existing.id, payload);
      return;
    }
    try {
      await this.snapshotRepository.save(
        this.snapshotRepository.create({
          ...payload,
          inviteId: input.inviteId,
          userId: input.userId,
          role: input.role,
          scaleVersionId: input.scaleVersionId,
        }),
      );
    } catch (error) {
      // 并发重复提交：唯一键冲突说明快照已存在，改为更新（不视为失败）
      if (!isDuplicateKeyError(error)) throw error;
      await this.snapshotRepository.update(
        { inviteId: input.inviteId, userId: input.userId },
        payload,
      );
    }
  }

  // ------------------------------------------------------------ 创建期校验

  /** 创建冷即（C8 防「取消后立刻重建」刷邀请码；与接口限流互补：限流管频率，冷却管幂等窗口） */
  private async assertCreateCooldown(userId: number): Promise<void> {
    const result = await this.redis.allowBySlidingWindow(
      `${INVITE_CREATE_COOLDOWN_PREFIX}${userId}`,
      INVITE_CREATE_COOLDOWN_SEC * 1000,
      1,
      `${Date.now()}`,
    );
    if (!result.allowed) {
      throw new BusinessException(ErrorCode.RATE_LIMITED);
    }
  }

  /**
   * 取发起方**同版本**的可复用单人答卷（ADR-005 决策 7 的创建前置条件）
   * 版本必须与邀请锁定的版本完全一致：跨版本比对会让差值失真（B8）。
   */
  private async requireInitiatorSheet(
    userId: number,
    scaleVersionId: number,
  ): Promise<ReusableSingleSheet> {
    const sheet = await this.assessment.findReusableSingleSheet(userId, scaleVersionId);
    if (!sheet) {
      throw new BusinessException(ErrorCode.INVITE_PREREQUISITE_MISSING);
    }
    return sheet;
  }

  /** 同一发起方同时最多 1 个进行中邀请（PRD-002 §5 防囤积；终态不占额度） */
  private async assertNoActiveInvite(userId: number): Promise<void> {
    const active = await this.inviteRepository.findOne({
      where: { initiatorUid: userId, status: In([...ACTIVE_INVITE_STATUSES]) },
      order: { id: 'DESC' },
    });
    if (active) {
      throw new BusinessException(ErrorCode.INVITE_ALREADY_ACTIVE);
    }
  }

  /**
   * 建邀请行 + 冻结发起方快照（一个事务内完成）
   *
   * 为什么必须同事务：B6 要求「对比报告基于邀请创建时锁定的快照，不受重测影响」，
   * 若邀请行建好而发起方快照缺失，这条邀请将永远无法生成报告（worker 会一直判「双方快照不齐备」），
   * 且用户侧看不出异常。同事务保证「有邀请必有 A 端快照」。
   */
  private async createInviteWithSnapshot(input: {
    initiatorUid: number;
    scaleVersionId: number;
    replacedFromInviteId: number | null;
    initiatorSheet: ReusableSingleSheet;
  }): Promise<InviteEntity> {
    const expireAt = new Date(Date.now() + INVITE_EXPIRE_DAYS * DAY_MS);

    return this.dataSource.transaction(async (manager) => {
      const inviteRepository = manager.getRepository(InviteEntity);
      const snapshotRepository = manager.getRepository(AnswerSnapshotEntity);

      const invite = await this.saveInviteWithUniqueCode(inviteRepository, {
        initiatorUid: input.initiatorUid,
        inviteeUid: null,
        scaleVersionId: input.scaleVersionId,
        status: INVITE_STATUS.CREATED,
        reuseAllowed: 1,
        renewedCount: 0,
        replacedFromInviteId: input.replacedFromInviteId,
        remindCount: 0,
        remindAt: null,
        expireAt,
        openedAt: null,
        completedAt: null,
        declinedAt: null,
        cancelledAt: null,
      });

      await snapshotRepository.save(
        snapshotRepository.create({
          inviteId: Number(invite.id),
          userId: input.initiatorUid,
          role: SNAPSHOT_ROLE_INITIATOR,
          scaleVersionId: input.scaleVersionId,
          answersJson: input.initiatorSheet.answers,
          dimensionScoresJson: input.initiatorSheet.cache,
          qualityFlag: input.initiatorSheet.qualityFlag,
          baselineTriggered: input.initiatorSheet.cache.baseline.triggered ? 1 : 0,
          // 发起方快照必然来自其单人答卷（创建前置即「已完成同版本单人测评」），故恒为复用
          isReuse: 1,
          durationSec: input.initiatorSheet.durationSec,
          completedAt: input.initiatorSheet.submittedAt
            ? new Date(input.initiatorSheet.submittedAt)
            : new Date(),
        }),
      );

      return invite;
    });
  }

  /** 生成唯一邀请码并落库（128 位随机的理论冲突概率可忽略，重试仅为兜底） */
  private async saveInviteWithUniqueCode(
    repository: Repository<InviteEntity>,
    init: Partial<InviteEntity>,
  ): Promise<InviteEntity> {
    for (let attempt = 1; attempt <= INVITE_CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = randomBytes(INVITE_CODE_BYTES).toString('hex');
      try {
        return await repository.save(repository.create({ ...init, code }));
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        this.logger.warn(
          `邀请码唯一键冲突，重新生成：第 ${attempt}/${INVITE_CODE_MAX_ATTEMPTS} 次`,
          'InviteService',
        );
      }
    }
    throw new Error(`邀请码连续 ${INVITE_CODE_MAX_ATTEMPTS} 次冲突，放弃创建邀请`);
  }

  // ------------------------------------------------------------ 取数与校验

  /** 按邀请码取邀请（格式不符直接当不存在，避免拿任意串打库）；顺带做一次过期懒判定 */
  private async loadByCode(code: string): Promise<InviteEntity> {
    if (!INVITE_CODE_PATTERN.test(code)) {
      throw new BusinessException(ErrorCode.INVITE_NOT_FOUND);
    }
    const invite = await this.inviteRepository.findOne({ where: { code } });
    if (!invite) {
      throw new BusinessException(ErrorCode.INVITE_NOT_FOUND);
    }
    return this.applyLazyExpire(invite);
  }

  /**
   * 过期懒判定（C4）
   * 定时扫描每小时一轮，若只依赖它，用户最长会看到 1 小时「没过期但也不能作答」的中间态；
   * 读路径顺带判定即可把窗口收敛到「下一次请求」。
   */
  private async applyLazyExpire(invite: InviteEntity): Promise<InviteEntity> {
    if (!EXPIRABLE_INVITE_STATUSES.includes(invite.status)) return invite;
    if (invite.expireAt.getTime() >= Date.now()) return invite;

    await this.inviteRepository.update(
      { id: invite.id, status: In([...EXPIRABLE_INVITE_STATUSES]) },
      { status: INVITE_STATUS.EXPIRED },
    );
    invite.status = INVITE_STATUS.EXPIRED;
    this.logger.log(
      `邀请已过期（懒判定）：inviteId=${invite.id} 过期时间=${invite.expireAt.toISOString()}，` +
        '发起方仍可续期 7 天一次（C4）',
      'InviteService',
    );
    return invite;
  }

  /** 可被打开的状态校验：过期给出可续期提示，已取消等同不存在 */
  private assertOpenable(invite: InviteEntity): void {
    if (invite.status === INVITE_STATUS.EXPIRED) {
      throw new BusinessException(ErrorCode.INVITE_EXPIRED);
    }
    if (invite.status === INVITE_STATUS.CANCELLED) {
      throw new BusinessException(ErrorCode.INVITE_NOT_FOUND);
    }
  }

  /** 可作答的状态校验（答题/交卷/复用的公共前置） */
  private assertAnswerable(invite: InviteEntity): void {
    if (invite.status === INVITE_STATUS.EXPIRED) {
      throw new BusinessException(ErrorCode.INVITE_EXPIRED);
    }
    if (
      invite.status !== INVITE_STATUS.CONSENT_GIVEN &&
      invite.status !== INVITE_STATUS.ANSWERING
    ) {
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '请先完成知情同意再开始作答');
    }
  }

  /**
   * 参与方校验（F4）
   * 非参与方与「邀请不存在」返回同一错误（404）：若分别返回 404 与 403，
   * 攻击者可用自增 id 逐个探测哪些邀请真实存在（枚举 oracle，泄露业务量）。
   * 归属校验本身仍严格生效，越权尝试照常打 warn 日志供运维告警，只是不把差异回给调用方。
   */
  private async requireParticipant(
    invite: InviteEntity,
    userId: number,
    action: string,
  ): Promise<InviteRole> {
    if (Number(invite.initiatorUid) === Number(userId)) return 'initiator';
    if (invite.inviteeUid !== null && Number(invite.inviteeUid) === Number(userId)) {
      return 'invitee';
    }
    this.logger.warn(
      `越权访问邀请被拒：inviteId=${invite.id} 访问者=${userId} 动作=${action}（对外与「不存在」返回一致）`,
      'InviteService',
    );
    throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '邀请不存在或已失效');
  }

  /** 按 id 取邀请并要求当前用户是发起方（提醒/续期/取消/换人共用） */
  private async requireInitiatorById(
    userId: number,
    inviteId: number,
    action: string,
  ): Promise<InviteEntity> {
    const invite = await this.inviteRepository.findOne({ where: { id: inviteId } });
    if (!invite) {
      // ADR-005 决策 1：按 id 访问时「不存在」与「越权」必须同一响应 ——
      // 若此处回 40001 而越权回 10002，攻击者可用自增 id 探测哪些邀请真实存在。
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '邀请不存在或已失效');
    }
    const role = await this.requireParticipant(invite, userId, action);
    if (role !== 'initiator') {
      // 能走到这里说明调用方是**被邀请方**（非参与方已被上一行按 10002 拦下），
      // 对方本就知晓该邀请存在，故给出明确原因而不是伪装「不存在」。
      throw new BusinessException(ErrorCode.INVITE_STATUS_INVALID, '仅发起方可执行该操作');
    }
    return this.applyLazyExpire(invite);
  }

  /**
   * C1 绑定：第一个完成授权登录的人占用被邀请方名额
   * 用条件更新（`invitee_uid IS NULL`）作 CAS，把并发收敛在数据库层，
   * 避免「先查后写」在两人同时点开链接时都以为自己是第一个。
   */
  private async bindFirstInvitee(invite: InviteEntity, userId: number): Promise<boolean> {
    const openedAt = new Date();
    const result = await this.inviteRepository.update(
      { id: invite.id, inviteeUid: IsNull(), status: INVITE_STATUS.CREATED },
      { inviteeUid: userId, status: INVITE_STATUS.OPENED, openedAt },
    );
    if ((result.affected ?? 0) === 0) return false;

    invite.inviteeUid = userId;
    invite.status = INVITE_STATUS.OPENED;
    invite.openedAt = openedAt;
    return true;
  }

  // -------------------------------------------------------------- 视图构造

  private toCreateResult(invite: InviteEntity, scaleVersion: string): InviteCreateResult {
    return {
      inviteId: Number(invite.id),
      code: invite.code,
      status: invite.status,
      scaleVersionId: Number(invite.scaleVersionId),
      scaleVersion,
      expireAt: invite.expireAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
      replacedFromInviteId:
        invite.replacedFromInviteId === null ? null : Number(invite.replacedFromInviteId),
    };
  }

  private async buildInitiatorView(
    invite: InviteEntity,
    versionCache: Map<number, string>,
  ): Promise<InviteInitiatorView> {
    const report = await this.reportRecord.findByInviteId(Number(invite.id));
    const nicknames =
      invite.inviteeUid === null
        ? new Map<number, string | null>()
        : await this.account.findNicknames([Number(invite.inviteeUid)]);

    return {
      inviteId: Number(invite.id),
      code: invite.code,
      role: 'initiator',
      status: invite.status,
      scaleVersion: await this.versionString(Number(invite.scaleVersionId), versionCache),
      createdAt: invite.createdAt.toISOString(),
      expireAt: invite.expireAt.toISOString(),
      completedAt: invite.completedAt ? invite.completedAt.toISOString() : null,
      // C1：未绑定说明对方还没打开过；对外只暴露「有没有人进来」，不暴露是谁
      inviteeBound: invite.inviteeUid !== null,
      inviteeNickname:
        invite.inviteeUid === null ? null : nicknames.get(Number(invite.inviteeUid)) ?? null,
      remindRemaining: Math.max(0, INVITE_REMIND_MAX - invite.remindCount),
      remindTemplateId: this.remindTemplateId(),
      renewRemaining: Math.max(0, INVITE_RENEW_MAX - invite.renewedCount),
      canReplace: await this.canReplace(invite),
      reportStatus: report ? report.status : null,
    };
  }

  private async buildInviteeView(
    invite: InviteEntity,
    userId: number,
    versionCache: Map<number, string>,
  ): Promise<InviteInviteeView> {
    const report = await this.reportRecord.findByInviteId(Number(invite.id));
    const nicknames = await this.account.findNicknames([Number(invite.initiatorUid)]);
    const sheet = await this.assessment.getInviteDetail(userId, Number(invite.id));

    const reuseAllowed = invite.reuseAllowed === 1;
    const reusable = reuseAllowed
      ? await this.assessment.findReusableSingleSheet(userId, Number(invite.scaleVersionId))
      : null;

    return {
      inviteId: Number(invite.id),
      code: invite.code,
      role: 'invitee',
      status: invite.status,
      scaleVersion: await this.versionString(Number(invite.scaleVersionId), versionCache),
      expireAt: invite.expireAt.toISOString(),
      // R8 文案逐字一致：端上不硬编码，由服务端下发
      consentText: INVITE_CONSENT_TEXT,
      consentGiven: ANSWERED_INVITE_STATUSES.includes(invite.status),
      remindTemplateId: this.remindTemplateId(),
      initiatorNickname: nicknames.get(Number(invite.initiatorUid)) ?? null,
      reuse: {
        allowed: reuseAllowed,
        available: reusable !== null,
        sheetId: reusable ? reusable.sheetId : null,
        submittedAt: reusable ? reusable.submittedAt : null,
      },
      sheetId: sheet ? sheet.sheet.id : null,
      reportStatus: report ? report.status : null,
    };
  }

  /** C7 换人可用性：仅 declined 且该条未派生过新邀请 */
  private async canReplace(invite: InviteEntity): Promise<boolean> {
    if (invite.status !== INVITE_STATUS.DECLINED) return false;
    const derived = await this.inviteRepository.count({
      where: { replacedFromInviteId: invite.id },
    });
    return derived < INVITE_REPLACEMENT_MAX;
  }

  /** 渲染 L1（发起方）或 L2（被邀请方）报告正文 */
  private async renderView(invite: InviteEntity, role: InviteRole): Promise<InviteReportView> {
    const level: ReportLevel = role === 'initiator' ? REPORT_LEVEL.L1 : REPORT_LEVEL.L2;
    const report = await this.reportRecord.findByInviteId(Number(invite.id));
    if (!report || report.status !== REPORT_STATUS.READY) {
      throw new BusinessException(ErrorCode.REPORT_NOT_READY);
    }

    const loaded = await this.reportTemplate.loadDoubleTemplate({
      scaleVersionId: Number(invite.scaleVersionId),
      level,
      // ADR-005 决策 5：只有 L1 记 template_version_id；L2/L3 恒取最新同层级模板
      frozenTemplateId:
        level === REPORT_LEVEL.L1 && report.templateVersionId !== null
          ? Number(report.templateVersionId)
          : null,
    });
    if (!loaded) {
      this.logger.error(
        `双人报告模板缺失：scaleVersionId=${invite.scaleVersionId} level=${level}，请执行 npm run report:seed`,
        undefined,
        'InviteService',
      );
      throw new BusinessException(ErrorCode.REPORT_NOT_READY, DOUBLE_REPORT_TEMPLATE_MISSING_MESSAGE);
    }

    const data = this.toStoredDoubleReport(report);
    const nicknames = await this.loadNicknames(invite);
    const scaleVersion = await this.versionString(Number(invite.scaleVersionId), new Map());
    const lowQuality = await this.hasLowQualitySnapshot(Number(invite.id));
    const baselineTriggered = report.baselineTriggered === 1;
    const generatedAt = (report.generatedAt ?? report.createdAt).toISOString();

    const rendered = this.render.render({
      level,
      template: this.toRenderableTemplate(loaded),
      data,
      nicknames,
      scaleVersion,
      baselineTriggered,
      lowQuality,
      renderedAt: new Date(),
    });

    if (level === REPORT_LEVEL.L1) {
      return {
        reportId: Number(report.id),
        inviteId: Number(invite.id),
        level: 'L1',
        status: 'ready',
        scaleVersion,
        generatedAt,
        selfNickname: nicknames.a,
        partnerNickname: nicknames.b,
        dimensions: this.render.mergeDimensionRows(data),
        unevaluatedDimensions: data.dimensionScores.unevaluated,
        consensusCodes: data.diffs.consensusCodes,
        pendingCodes: data.diffs.pendingCodes,
        divergenceItems: this.render.mergeDivergence(data),
        consensusItems: data.consensus,
        baselineNotice: baselineTriggered ? BASELINE_NOTICE_MESSAGE : null,
        lowQualityNotice: lowQuality ? LOW_QUALITY_NOTICE_MESSAGE : null,
        blocks: rendered.blocks,
        disclaimer: rendered.disclaimer,
      };
    }

    return {
      reportId: Number(report.id),
      inviteId: Number(invite.id),
      level: 'L2',
      status: 'ready',
      scaleVersion,
      generatedAt,
      selfNickname: nicknames.b,
      partnerNickname: nicknames.a,
      consensusItems: data.consensus,
      baselineNotice: baselineTriggered ? BASELINE_NOTICE_MESSAGE : null,
      blocks: rendered.blocks,
      disclaimer: rendered.disclaimer,
    };
  }

  /** 双方昵称（A=发起方，B=被邀请方；为空给兜底展示名，不落库） */
  private async loadNicknames(invite: InviteEntity): Promise<{ a: string; b: string }> {
    const ids = [Number(invite.initiatorUid)];
    if (invite.inviteeUid !== null) ids.push(Number(invite.inviteeUid));
    const nicknames = await this.account.findNicknames(ids);

    const initiator = nicknames.get(Number(invite.initiatorUid));
    const invitee = invite.inviteeUid === null ? null : nicknames.get(Number(invite.inviteeUid));
    return {
      a: initiator && initiator.trim() ? initiator.trim() : NICKNAME_FALLBACK.INITIATOR,
      b: invitee && invitee.trim() ? invitee.trim() : NICKNAME_FALLBACK.INVITEE,
    };
  }

  /** C10：任一方低质量即统一提示（不暴露是哪一方） */
  private async hasLowQualitySnapshot(inviteId: number): Promise<boolean> {
    const snapshots = await this.snapshotRepository.find({ where: { inviteId } });
    return snapshots.some((snapshot) => {
      const cache = snapshot.dimensionScoresJson as SheetScoresCache | null;
      return cache?.quality?.isLowQuality === true;
    });
  }

  /** report 行 → 渲染输入（结构损坏时退化为空结论，让页面可打开而不是 500） */
  private toStoredDoubleReport(report: {
    dimensionScoresJson: unknown;
    diffsJson: unknown;
    flaggedItemsJson: unknown;
    consensusJson: unknown;
  }): StoredDoubleReport {
    return {
      dimensionScores: (report.dimensionScoresJson ?? EMPTY_DIMENSION_SCORES) as StoredDimensionScores,
      diffs: (report.diffsJson ?? EMPTY_DIFFS) as StoredDiffs,
      flagged: (report.flaggedItemsJson ?? EMPTY_FLAGGED) as StoredFlaggedItems,
      consensus: Array.isArray(report.consensusJson)
        ? (report.consensusJson as DoubleConsensusItem[])
        : [],
    };
  }

  private toRenderableTemplate(loaded: {
    template: { id: number; disclaimer: string };
    blocks: Array<{
      blockKey: string;
      orderNo: number;
      templateText: string;
      gapLevel: string | null;
      minChars: number | null;
    }>;
  }): RenderableTemplate {
    return {
      templateId: Number(loaded.template.id),
      disclaimer: loaded.template.disclaimer,
      blocks: loaded.blocks.map((block) => ({
        blockKey: block.blockKey,
        orderNo: block.orderNo,
        templateText: block.templateText,
        gapLevel: block.gapLevel,
        minChars: block.minChars,
      })),
    };
  }

  /** 量表版本号（同一请求内多行复用，避免逐行查库） */
  private async versionString(scaleVersionId: number, cache: Map<number, string>): Promise<string> {
    const cached = cache.get(scaleVersionId);
    if (cached) return cached;
    const version = await this.scaleQuery.getVersionOrFail(scaleVersionId);
    cache.set(scaleVersionId, version.version);
    return version.version;
  }

  /** 按码点截断（emoji 记 1；订阅消息 thing 类字段超长会被微信整条拒绝） */
  private truncateChars(text: string, max: number): string {
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join('');
  }

  /** 订阅消息 time 类型要求 `YYYY-MM-DD HH:mm`（本地时区） */
  private formatDateTime(date: Date): string {
    const pad = (value: number): string => `${value}`.padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  /** 长图日期文案（本地时区 YYYY-MM-DD） */
  private formatDate(date: Date): string {
    const pad = (value: number): string => `${value}`.padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}
