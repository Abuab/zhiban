import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { RenderContext, RenderedBlock } from '../../engines/report/report.types.js';
import { renderBlocks } from '../../engines/report/template.engine.js';
import { scoreP16 } from '../../engines/scale/p16.engine.js';
import { LOW_QUALITY_NOTICE_MESSAGE } from '../../engines/scale/scale.constants.js';
import { scorePreScale } from '../../engines/scale/scoring.engine.js';
import type {
  AnswerMap,
  BaselineResult,
  ScaleQuestion,
} from '../../engines/scale/scale.types.js';
import { ReportTemplateService } from '../report/report-template.service.js';
import { ScaleQueryService, type ScaleBundle } from '../scale/scale-query.service.js';
import {
  MISSING_CODE_PREVIEW_LIMIT,
  PAYWALL_BLOCK_KEY,
  QUALITY_FLAG_LOW,
  REPORT_AUDIENCE_SINGLE,
  REPORT_TEMPLATE_MISSING_MESSAGE,
  SCENE_INVITE,
  SCENE_P16,
  SCENE_SCALE_CODE,
  SCENE_SINGLE,
  SHEET_STATUS_DRAFT,
  SHEET_STATUS_SUBMITTED,
} from './assessment.constants.js';
import {
  buildProgress,
  collectSkippedQuestionCodes,
  findMissingQuestionCodes,
  resolveSkippedDimensions,
  sanitizeAnswers,
  toPaperDimensions,
  toPaperQuestions,
} from './assessment.mapper.js';
import type {
  AssessmentDetail,
  AssessmentReport,
  AssessmentScene,
  DimensionOutcome,
  InviteSubmitResult,
  LatestSubmittedSheet,
  Paper,
  ReusableSingleSheet,
  ResumeSummary,
  SheetScoresCache,
  SheetState,
  StartableScene,
} from './assessment.types.js';
import type { SaveAnswersDto, SubmitAssessmentDto } from './dto/save-answers.dto.js';
import type { SupplementAssessmentDto } from './dto/supplement-assessment.dto.js';
import { AnswerSheetEntity } from './entities/answer-sheet.entity.js';

/** 底线题未触发时的空结果（16 型量表的基线结论） */
const NO_BASELINE: BaselineResult = { triggered: false, triggeredCodes: [], message: '' };

/**
 * 单人测评流程服务（模块 4）
 *
 * 覆盖 prompt.md 模块 4 的三项要求：
 *   1. 答题流程：断点续答（B1）、进度、敏感维度前置同意（B7）
 *   2. 简版报告生成（规格 2.3 页脚免责声明 + 价值感标准 §一「一句话点评 ≤30 字」）
 *   3. 付费墙锁定占位（价值感标准 §三 信息差可视化，文案落 report_template_block）
 *
 * 规格与决策依据：
 *   - 边界总表 B1 / B3 / B4 / B5 / B6 / B7 / B8 / B9；假设 A-1 / A-4
 *   - 计分规则 1 / 2 / 6 / 7 / 8（L1 引擎已实现，本服务只负责取数与落库）
 *   - docs/adr/ADR-004.md（跳过维度状态、报告区块约定、交卷后锁定与补答例外）
 *
 * 安全自查（铁律 #6「恶意用户会怎么攻击这里」）：
 *   - 越权：所有 :id 接口先校验 answer_sheet.user_id === 当前登录用户，否则 403（隐私约束 2.4）
 *   - 篡改计分：客户端传来的题型/分档一律不信，按锁定版本的题目定义逐题净化（assessment.mapper）
 *   - 逃避作答：只允许跳过**敏感维度**（is_sensitive = 1），普通维度不可跳过
 *   - 刷进度/刷报告：进度与完整性均由服务端按题目定义重算，不采信客户端上报的计数
 *   - 多端覆盖：draftVersion 乐观锁，版本不一致直接拒绝（A3）
 */
@Injectable()
export class AssessmentService {
  constructor(
    @InjectRepository(AnswerSheetEntity)
    private readonly sheetRepository: Repository<AnswerSheetEntity>,
    private readonly scaleQuery: ScaleQueryService,
    private readonly reportTemplate: ReportTemplateService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 开始作答：已有进行中的草稿则续答（B1），否则按生效版本新建一份答题卷
   * B6：交卷后再次调用会新建一份答题卷（重测），历史答卷与其报告不受影响
   */
  async start(userId: number, scene: StartableScene): Promise<AssessmentDetail> {
    const existing = await this.findCurrentDraft(userId, scene);
    if (existing) {
      this.logger.log(
        `续答进行中的草稿：userId=${userId} scene=${scene} sheetId=${existing.id}`,
        'AssessmentService',
      );
      return this.buildDetail(existing);
    }

    const version = await this.scaleQuery.findActiveVersionByScaleCode(SCENE_SCALE_CODE[scene]);
    if (!version) {
      throw new BusinessException(
        ErrorCode.SCALE_NOT_FOUND,
        `量表 ${SCENE_SCALE_CODE[scene]} 没有生效版本，暂时无法开始作答`,
      );
    }

    const created = await this.sheetRepository.save(
      this.sheetRepository.create({
        userId,
        scaleVersionId: version.id,
        scene,
        inviteId: null,
        answersJson: null,
        skippedDimensionsJson: null,
        draftVersion: 0,
        answeredCount: 0,
        durationSec: null,
        qualityFlag: null,
        dimensionScoresJson: null,
        status: SHEET_STATUS_DRAFT,
        startedAt: new Date(),
        submittedAt: null,
      }),
    );

    this.logger.log(
      `新建答题卷：userId=${userId} scene=${scene} sheetId=${created.id} 量表版本=${version.id}`,
      'AssessmentService',
    );
    return this.buildDetail(created);
  }

  /**
   * 续答入口摘要（B1：入口显示「继续上次（已完成 32/76 题）」）
   * 无进行中的草稿时返回 null，客户端据此展示「开始测评」
   */
  async getCurrent(userId: number, scene: StartableScene): Promise<ResumeSummary | null> {
    const draft = await this.findCurrentDraft(userId, scene);
    if (!draft) return null;

    const context = await this.loadContext(draft);
    const progress = buildProgress(
      context.bundle.engineQuestions,
      context.answers,
      context.skippedQuestionCodes,
    );
    return {
      id: Number(draft.id),
      scene: draft.scene,
      answeredCount: progress.answeredCount,
      totalCount: progress.totalCount,
      progressPercent: progress.progressPercent,
      startedAt: this.toIso(draft.startedAt),
    };
  }

  /** 答题页数据（状态 + 题目，一次拉齐，减少小程序往返） */
  async getDetail(userId: number, sheetId: number): Promise<AssessmentDetail> {
    return this.buildDetail(await this.requireOwnedSheet(userId, sheetId));
  }

  /**
   * 保存草稿（B1 断点续答 / B2 弱网补传 / A3 乐观锁）
   * answers 为**增量合并**语义：本次未出现的题号保留原答案，便于弱网下分批补传。
   */
  async saveDraft(userId: number, sheetId: number, dto: SaveAnswersDto): Promise<SheetState> {
    const sheet = await this.requireOwnedSheet(userId, sheetId);
    return this.saveDraftOnSheet(sheet, dto);
  }

  /**
   * 草稿写入的共用实现（单人 saveDraft 与邀请 saveInviteDraft 共用）
   * 差别只在「怎么拿到卷」，拿到之后的锁定校验、净化、合并、乐观锁完全一致 —— 保持一致才能保证
   * B5/B7/A3 三套约束在双人流程里同样生效（双人报告涉双方数据，约束只能更严不能更松）。
   */
  private async saveDraftOnSheet(
    sheet: AnswerSheetEntity,
    dto: SaveAnswersDto,
  ): Promise<SheetState> {
    this.assertDraftEditable(sheet);
    this.assertDraftVersion(sheet, dto.draftVersion);

    const context = await this.loadContext(sheet);
    const skipped = this.resolveSkipped(context.bundle, dto.skippedDimensions);
    const excludedCodes = collectSkippedQuestionCodes(context.bundle.engineQuestions, skipped);

    const { answers, ignoredCodes } = sanitizeAnswers(
      context.bundle.engineQuestions,
      dto.answers,
      excludedCodes,
    );
    this.warnIgnoredAnswers(sheet.id, ignoredCodes);

    const merged = this.applyExclusions({ ...context.answers, ...answers }, excludedCodes);

    const patch: Partial<AnswerSheetEntity> = {
      answersJson: merged,
      skippedDimensionsJson: skipped,
      draftVersion: sheet.draftVersion + 1,
      answeredCount: buildProgress(context.bundle.engineQuestions, merged, excludedCodes).answeredCount,
    };
    await this.sheetRepository.update(sheet.id, patch);
    // sheet 是本次请求的本地快照（非托管实体），就地补齐补丁以便复用它组装返回结构
    Object.assign(sheet, patch);

    return this.toSheetState(
      sheet,
      merged,
      skipped,
      context.bundle.engineQuestions,
      excludedCodes,
    );
  }

  /**
   * 交卷（B5：交卷后答案锁定；B7：被跳过维度不计分并在报告标注「未评估」）
   * 一次性完成：完整性校验 → 计分 → 落库（含维度分缓存）→ 返回简版报告
   */
  async submit(
    userId: number,
    sheetId: number,
    dto: SubmitAssessmentDto,
  ): Promise<AssessmentReport> {
    const sheet = await this.requireOwnedSheet(userId, sheetId);
    this.assertDraftEditable(sheet);
    this.assertDraftVersion(sheet, dto.draftVersion);

    const context = await this.loadContext(sheet);
    const skipped = this.resolveSkipped(context.bundle, dto.skippedDimensions);
    const excludedCodes = collectSkippedQuestionCodes(context.bundle.engineQuestions, skipped);

    const { answers, ignoredCodes } = sanitizeAnswers(
      context.bundle.engineQuestions,
      dto.answers,
      excludedCodes,
    );
    this.warnIgnoredAnswers(sheet.id, ignoredCodes);

    const merged = this.applyExclusions({ ...context.answers, ...answers }, excludedCodes);
    this.assertComplete(sheet.id, context.bundle.engineQuestions, merged, excludedCodes);

    const cache = this.computeScores({
      scene: sheet.scene,
      bundle: context.bundle,
      answers: merged,
      durationSec: dto.durationSec,
      skipped,
      supplemented: [],
    });

    const patch: Partial<AnswerSheetEntity> = {
      answersJson: merged,
      skippedDimensionsJson: skipped,
      draftVersion: sheet.draftVersion + 1,
      answeredCount: buildProgress(context.bundle.engineQuestions, merged, excludedCodes).answeredCount,
      durationSec: dto.durationSec,
      qualityFlag: cache.quality.isLowQuality ? QUALITY_FLAG_LOW : null,
      dimensionScoresJson: cache,
      status: SHEET_STATUS_SUBMITTED,
      submittedAt: new Date(),
    };
    await this.sheetRepository.update(sheet.id, patch);
    Object.assign(sheet, patch);

    this.logger.log(
      `交卷完成：userId=${userId} sheetId=${sheet.id} scene=${sheet.scene} ` +
        `已答=${patch.answeredCount} 跳过维度=${skipped.length} ` +
        `质量=${cache.quality.isLowQuality ? 'low' : 'ok'} 底线触发=${cache.baseline.triggered}`,
      'AssessmentService',
    );

    return this.buildReport(sheet, context.bundle, cache);
  }

  /** 读取简版报告（未交卷时不可见，避免出现「半份报告」） */
  async getReport(userId: number, sheetId: number): Promise<AssessmentReport> {
    const sheet = await this.requireOwnedSheet(userId, sheetId);
    const cache = this.requireSubmitted(sheet);
    const bundle = await this.scaleQuery.loadBundle(sheet.scaleVersionId, { includeOffline: true });
    return this.buildReport(sheet, bundle, cache);
  }

  /**
   * 补答被跳过的敏感维度（B7「允许事后补答」/ A-4）
   * B5 的唯一例外：只接受被跳过维度的题号，其余题号（含已锁定答案）一律丢弃。
   */
  async supplement(
    userId: number,
    sheetId: number,
    dto: SupplementAssessmentDto,
  ): Promise<AssessmentReport> {
    const sheet = await this.requireOwnedSheet(userId, sheetId);
    const cache = this.requireSubmitted(sheet);

    const pending = cache.skipped;
    if (pending.length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有需要补答的维度');
    }

    const bundle = await this.scaleQuery.loadBundle(sheet.scaleVersionId, { includeOffline: true });
    const pendingCodes = collectSkippedQuestionCodes(bundle.engineQuestions, pending);
    // 补答之外的题号（即锁定的已答题目）一律排除，等价于「只有被跳过维度可写」
    const lockedCodes = new Set(
      bundle.engineQuestions.map((question) => question.code).filter((code) => !pendingCodes.has(code)),
    );

    const { answers, ignoredCodes } = sanitizeAnswers(bundle.engineQuestions, dto.answers, lockedCodes);
    if (ignoredCodes.length > 0) {
      this.logger.warn(
        `补答时丢弃了 ${ignoredCodes.length} 条不可写的答案（已交卷题目锁定，B5）：` +
          `sheetId=${sheet.id} 题号=${this.previewCodes(ignoredCodes)}`,
        'AssessmentService',
      );
    }

    const missing = findMissingQuestionCodes(bundle.engineQuestions, answers, lockedCodes);
    if (missing.length > 0) {
      throw new BusinessException(
        ErrorCode.ANSWER_INCOMPLETE,
        `补答需一次补齐该维度的全部题目，还有 ${missing.length} 道未作答（如 ${this.previewCodes(missing)}）`,
      );
    }

    const merged: AnswerMap = { ...(sheet.answersJson ?? {}), ...answers };
    // 补答后该维度转为已评估，并在报告中标记「补测」（ADR-004 决策 2）
    const nextCache = this.computeScores({
      scene: sheet.scene,
      bundle,
      answers: merged,
      durationSec: sheet.durationSec ?? 0,
      skipped: [],
      supplemented: pending,
    });

    const patch: Partial<AnswerSheetEntity> = {
      answersJson: merged,
      skippedDimensionsJson: [],
      draftVersion: sheet.draftVersion + 1,
      qualityFlag: nextCache.quality.isLowQuality ? QUALITY_FLAG_LOW : null,
      dimensionScoresJson: nextCache,
    };
    await this.sheetRepository.update(sheet.id, patch);
    Object.assign(sheet, patch);

    this.logger.log(
      `补答完成：userId=${userId} sheetId=${sheet.id} 补测维度=${pending.join('、')}`,
      'AssessmentService',
    );

    return this.buildReport(sheet, bundle, nextCache);
  }

  // ------------------------------------------------- 双人邀请场景（模块 5）

  /**
   * 打开/续答邀请答卷（scene='invite'）
   *
   * 与单人 `start` 的关键差异：**不做重测**。邀请只有一次作答机会
   * （已交卷则原样返回已交卷的卷，客户端据此展示「已完成，等待对方」），
   * 否则「重测」会凭空再造一份快照，把对方的等待变成无底洞。
   * B8：量表版本由邀请锁定后传入，不按当前生效版本取值。
   */
  async openInviteSheet(
    userId: number,
    inviteId: number,
    scaleVersionId: number,
  ): Promise<AssessmentDetail> {
    const existing = await this.findInviteSheet(userId, inviteId);
    if (existing) return this.buildDetail(existing);

    const created = await this.sheetRepository.save(
      this.sheetRepository.create({
        userId,
        scaleVersionId,
        scene: SCENE_INVITE,
        inviteId,
        answersJson: null,
        skippedDimensionsJson: null,
        draftVersion: 0,
        answeredCount: 0,
        durationSec: null,
        qualityFlag: null,
        dimensionScoresJson: null,
        status: SHEET_STATUS_DRAFT,
        startedAt: new Date(),
        submittedAt: null,
      }),
    );
    this.logger.log(
      `新建邀请答题卷：userId=${userId} inviteId=${inviteId} sheetId=${created.id} 量表版本=${scaleVersionId}`,
      'AssessmentService',
    );
    return this.buildDetail(created);
  }

  /** 邀请答卷的答题页数据；尚未开始时返回 null（客户端据此先创建再渲染） */
  async getInviteDetail(userId: number, inviteId: number): Promise<AssessmentDetail | null> {
    const sheet = await this.findInviteSheet(userId, inviteId);
    return sheet ? this.buildDetail(sheet) : null;
  }

  /** 保存邀请答题草稿（B1 断点续答 / B2 弱网补传 / A3 乐观锁），语义同单人 saveDraft */
  async saveInviteDraft(
    userId: number,
    inviteId: number,
    dto: SaveAnswersDto,
  ): Promise<SheetState> {
    const sheet = await this.requireOwnedInviteSheet(userId, inviteId);
    return this.saveDraftOnSheet(sheet, dto);
  }

  /**
   * 邀请交卷：计分后把「快照原料」交回邀请域冻结进 answer_snapshot（B8 不可变）
   * 交卷后答案锁定（B5），邀请域随即校验双方是否齐备并按需入队生成报告（R6）。
   */
  async submitInvite(
    userId: number,
    inviteId: number,
    dto: SubmitAssessmentDto,
  ): Promise<InviteSubmitResult> {
    const sheet = await this.requireOwnedInviteSheet(userId, inviteId);
    this.assertDraftEditable(sheet);
    this.assertDraftVersion(sheet, dto.draftVersion);

    const context = await this.loadContext(sheet);
    const skipped = this.resolveSkipped(context.bundle, dto.skippedDimensions);
    const excludedCodes = collectSkippedQuestionCodes(context.bundle.engineQuestions, skipped);

    const { answers, ignoredCodes } = sanitizeAnswers(
      context.bundle.engineQuestions,
      dto.answers,
      excludedCodes,
    );
    this.warnIgnoredAnswers(sheet.id, ignoredCodes);

    const merged = this.applyExclusions({ ...context.answers, ...answers }, excludedCodes);
    this.assertComplete(sheet.id, context.bundle.engineQuestions, merged, excludedCodes);

    const cache = this.computeScores({
      scene: sheet.scene,
      bundle: context.bundle,
      answers: merged,
      durationSec: dto.durationSec,
      skipped,
      supplemented: [],
    });

    const patch: Partial<AnswerSheetEntity> = {
      answersJson: merged,
      skippedDimensionsJson: skipped,
      draftVersion: sheet.draftVersion + 1,
      answeredCount: buildProgress(context.bundle.engineQuestions, merged, excludedCodes).answeredCount,
      durationSec: dto.durationSec,
      qualityFlag: cache.quality.isLowQuality ? QUALITY_FLAG_LOW : null,
      dimensionScoresJson: cache,
      status: SHEET_STATUS_SUBMITTED,
      submittedAt: new Date(),
    };
    await this.sheetRepository.update(sheet.id, patch);

    this.logger.log(
      `邀请交卷完成：userId=${userId} inviteId=${inviteId} sheetId=${sheet.id} ` +
        `已答=${patch.answeredCount} 跳过维度=${skipped.length} ` +
        `质量=${cache.quality.isLowQuality ? 'low' : 'ok'} 底线触发=${cache.baseline.triggered}`,
      'AssessmentService',
    );

    return {
      sheetId: Number(sheet.id),
      answers: merged,
      cache,
      durationSec: dto.durationSec,
      qualityFlag: patch.qualityFlag ?? null,
    };
  }

  /**
   * 取可复用的历史单人答卷（C3 / R7）
   *
   * 严格限定 `scene='single'` 且量表版本与邀请锁定版本**完全一致**：
   *   - 16 型（p16）与邀请锁定的婚前评估量纲不同，复用会造成差值失真
   *   - 版本不一致时不允许复用（B8 快照一致性）
   */
  async findReusableSingleSheet(
    userId: number,
    scaleVersionId: number,
  ): Promise<ReusableSingleSheet | null> {
    const sheet = await this.sheetRepository.findOne({
      where: {
        userId,
        scene: SCENE_SINGLE,
        scaleVersionId,
        status: SHEET_STATUS_SUBMITTED,
      },
      order: { id: 'DESC' },
    });
    if (!sheet || !sheet.dimensionScoresJson) return null;

    return {
      sheetId: Number(sheet.id),
      submittedAt: this.toIso(sheet.submittedAt),
      answers: sheet.answersJson ?? {},
      cache: sheet.dimensionScoresJson,
      durationSec: sheet.durationSec,
      qualityFlag: sheet.qualityFlag,
    };
  }

  // ---------------------------------------------------------------- 内部实现

  /**
   * 取用户**最近一次已交卷**答卷的结论快照（模块 7 专属卡 prompt 取数，ADR-008 决策 1）
   *
   * 口径说明：
   *   - 不限量表版本：专属卡注入的是「人格类型 / 维度分」这类**画像结论**，
   *     与量表的锁定版本无关（双人报告的 B8 版本一致性约束不适用于专属卡）；
   *     历史答卷的结论不会因题库改版而失效，故取最近一次交卷即可。
   *   - 只读 `dimension_scores_json`（交卷时算好的结论），不重算、不读原始答案。
   *   - 无已交卷答卷时返回 null —— 这是**正常输入缺失**（用户还没做这类测评），
   *     由调用方决定省略对应 prompt 段落，不是错误。
   */
  async findLatestSubmittedSheet(
    userId: number,
    scene: AssessmentScene,
  ): Promise<LatestSubmittedSheet | null> {
    const sheet = await this.sheetRepository.findOne({
      where: { userId, scene, status: SHEET_STATUS_SUBMITTED },
      order: { id: 'DESC' },
    });
    if (!sheet || !sheet.dimensionScoresJson) return null;

    return {
      sheetId: Number(sheet.id),
      scene: sheet.scene,
      scaleVersionId: Number(sheet.scaleVersionId),
      submittedAt: this.toIso(sheet.submittedAt),
      cache: sheet.dimensionScoresJson,
    };
  }

  /** 定位某邀请下本人的答卷（不区分状态：草稿续答、已交卷回显都用同一入口） */
  private findInviteSheet(userId: number, inviteId: number): Promise<AnswerSheetEntity | null> {
    return this.sheetRepository.findOne({
      where: { userId, scene: SCENE_INVITE, inviteId },
      order: { id: 'DESC' },
    });
  }

  /** 取本人邀请答卷；缺失与越权一律返回同一错误（沿用 requireOwnedSheet 的口径） */
  private async requireOwnedInviteSheet(
    userId: number,
    inviteId: number,
  ): Promise<AnswerSheetEntity> {
    const sheet = await this.findInviteSheet(userId, inviteId);
    if (!sheet) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '答题卷不存在');
    }
    return sheet;
  }

  /** 定位最近一份进行中的草稿（B1）；同场景多份草稿时以 id 最大者为准 */
  private findCurrentDraft(
    userId: number,
    scene: StartableScene,
  ): Promise<AnswerSheetEntity | null> {
    return this.sheetRepository.findOne({
      where: { userId, scene, status: SHEET_STATUS_DRAFT },
      order: { id: 'DESC' },
    });
  }

  /**
   * 取本人答题卷
   *
   * 「不存在」与「别人的卷」**返回同一个错误**（10002/404）：若分别返回 10002 与 10004，
   * 攻击者用自增 id 逐个探测即可从状态码差异判断哪些 id 真实存在（枚举 oracle，泄露业务量）。
   * 归属校验本身仍严格生效（F4：逐请求校验资源归属），越权尝试照常打 warn 日志供运维告警，
   * 只是**不把差异回给调用方** —— 可观测性留在服务端，不泄露给对方。
   */
  private async requireOwnedSheet(userId: number, sheetId: number): Promise<AnswerSheetEntity> {
    const sheet = await this.sheetRepository.findOne({ where: { id: sheetId } });
    if (!sheet) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '答题卷不存在');
    }
    if (Number(sheet.userId) !== Number(userId)) {
      this.logger.warn(
        `越权访问答题卷被拒：sheetId=${sheetId} 访问者=${userId}（对外与「不存在」返回一致）`,
        'AssessmentService',
      );
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '答题卷不存在');
    }
    return sheet;
  }

  /** B5：交卷后答案锁定 */
  private assertDraftEditable(sheet: AnswerSheetEntity): void {
    if (sheet.status !== SHEET_STATUS_DRAFT) {
      throw new BusinessException(ErrorCode.ANSWER_LOCKED);
    }
  }

  /** A3：草稿版本乐观锁，防止同一微信的另一台设备覆盖本次写入 */
  private assertDraftVersion(sheet: AnswerSheetEntity, clientVersion: number): void {
    if (sheet.draftVersion !== clientVersion) {
      throw new BusinessException(
        ErrorCode.ANSWER_DRAFT_CONFLICT,
        `答案已在其他设备更新（服务端版本 ${sheet.draftVersion}，本次提交 ${clientVersion}），请刷新后重试`,
      );
    }
  }

  /** 已交卷校验；返回交卷时缓存的计分结果（未交卷/缓存缺失一律拒绝） */
  private requireSubmitted(sheet: AnswerSheetEntity): SheetScoresCache {
    if (sheet.status !== SHEET_STATUS_SUBMITTED || !sheet.dimensionScoresJson) {
      throw new BusinessException(ErrorCode.REPORT_NOT_READY, '还没交卷，完成答题后即可查看报告');
    }
    return sheet.dimensionScoresJson;
  }

  /** 装载一次作答所需的快照数据（题目按含下架题装载，保证进行中的答题卷稳定，见 G1） */
  private async loadContext(sheet: AnswerSheetEntity): Promise<SheetContext> {
    const bundle = await this.scaleQuery.loadBundle(sheet.scaleVersionId, { includeOffline: true });
    const skipped = sheet.skippedDimensionsJson ?? [];
    return {
      bundle,
      answers: sheet.answersJson ?? {},
      skipped,
      skippedQuestionCodes: collectSkippedQuestionCodes(bundle.engineQuestions, skipped),
    };
  }

  /** 校验并归一跳过维度：只允许敏感维度，非法编码直接拒绝（fail-closed） */
  private resolveSkipped(bundle: ScaleBundle, raw: string[] | undefined): string[] {
    const { skipped, invalid } = resolveSkippedDimensions(bundle.dimensions, raw);
    if (invalid.length > 0) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `该维度不支持跳过：${invalid.join('、')}`,
      );
    }
    return skipped;
  }

  /** 剔除被跳过维度的答案（即使客户端漏传了 skip 声明也不会污染计分） */
  private applyExclusions(answers: AnswerMap, excludedCodes: ReadonlySet<string>): AnswerMap {
    if (excludedCodes.size === 0) return answers;
    const result: AnswerMap = {};
    for (const [code, value] of Object.entries(answers)) {
      if (!excludedCodes.has(code)) result[code] = value;
    }
    return result;
  }

  /** 交卷完整性校验：除被跳过维度外，所有题目都必须有合法答案 */
  private assertComplete(
    sheetId: number,
    questions: ScaleQuestion[],
    answers: AnswerMap,
    excludedCodes: ReadonlySet<string>,
  ): void {
    const missing = findMissingQuestionCodes(questions, answers, excludedCodes);
    if (missing.length > 0) {
      this.logger.log(
        `交卷被拒（尚有未作答）：sheetId=${sheetId} 未答=${missing.length} 题`,
        'AssessmentService',
      );
      throw new BusinessException(
        ErrorCode.ANSWER_INCOMPLETE,
        `还有 ${missing.length} 道题未作答（如 ${this.previewCodes(missing)}），完成后即可交卷`,
      );
    }
  }

  /** 计分并组装落库缓存（计分全部由 L1 引擎完成，本方法不产生任何业务算法） */
  private computeScores(input: {
    scene: AssessmentScene;
    bundle: ScaleBundle;
    answers: AnswerMap;
    durationSec: number;
    skipped: string[];
    supplemented: string[];
  }): SheetScoresCache {
    const { scene, bundle, answers, durationSec, skipped, supplemented } = input;
    const computedAt = new Date().toISOString();

    if (scene === SCENE_P16) {
      const result = scoreP16({
        questions: bundle.engineQuestions,
        dimensions: bundle.engineDimensions,
        answers,
      });
      // 引擎只回维度编码，报告需要维度名（自研命名，UI 不出现官方代号）——在此补一次映射
      const nameByCode = new Map(bundle.engineDimensions.map((item) => [item.code, item.name]));
      return {
        dimensions: [],
        baseline: NO_BASELINE,
        // 16 型为快速版画像，不作低质量判定（规格只对婚前评估设 B3/B4）
        quality: { isLowQuality: false, reasons: [], durationSec },
        styleAnswer: null,
        p16: {
          typeKey: result.typeKey,
          typeName: result.typeName,
          dimensions: result.dimensions.map((item) => ({
            ...item,
            dimensionName: nameByCode.get(item.dimensionCode) ?? item.dimensionCode,
          })),
        },
        skipped: [],
        supplemented: [],
        computedAt,
      };
    }

    // 婚前评估依赖计分规则产出 0-100 维度分；缺失属部署事故（种子里漏跑 ensureDefaultScoringRule），
    // 在此 fail-closed —— 否则会拿 null 调用引擎，产出无维度分的「半份报告」
    // （16 型分支不需要规则，已在上面 return，不会走到这里）
    const rule = bundle.engineRule;
    if (!rule) {
      this.logger.error(
        `婚前评估量表版本缺少生效中的计分规则，无法计分：scaleVersionId=${bundle.version.id}`,
        undefined,
        'AssessmentService',
      );
      throw new BusinessException(
        ErrorCode.SCALE_NOT_FOUND,
        `量表版本 ${bundle.version.id} 缺少生效中的计分规则，无法计分`,
      );
    }

    const result = scorePreScale({
      questions: bundle.engineQuestions,
      dimensions: bundle.engineDimensions,
      answers,
      durationSec,
      rule,
    });

    const skippedSet = new Set(skipped);
    const supplementedSet = new Set(supplemented);
    const dimensions: DimensionOutcome[] = result.dimensions.map((item) => {
      const evaluated = !skippedSet.has(item.dimensionCode);
      return {
        code: item.dimensionCode,
        name: item.dimensionName,
        evaluated,
        // ⚠️ 未评估维度绝不写 0 分：全选 1 分恰好也得 0 分，写 0 会把「拒绝授权」误读为「极端取向」
        score: evaluated ? item.score : null,
        supplemented: evaluated && supplementedSet.has(item.dimensionCode),
      };
    });

    return {
      dimensions,
      baseline: result.baseline,
      quality: result.quality,
      styleAnswer: result.styleAnswer,
      p16: null,
      skipped,
      supplemented,
      computedAt,
    };
  }

  /** 组装简版报告（模板文案渲染时读取，改文案零发版） */
  private async buildReport(
    sheet: AnswerSheetEntity,
    bundle: ScaleBundle,
    cache: SheetScoresCache,
  ): Promise<AssessmentReport> {
    const loaded = await this.reportTemplate.loadActiveTemplate({
      audience: REPORT_AUDIENCE_SINGLE,
      scaleVersionId: sheet.scaleVersionId,
    });
    if (!loaded) {
      // 模板缺失 = 部署事故（缺页脚免责声明属合规问题），故 fail-closed 而不是返回残缺报告
      this.logger.error(
        `报告模板缺失：scaleVersionId=${sheet.scaleVersionId} audience=${REPORT_AUDIENCE_SINGLE}，` +
          '请在服务器执行 npm run report:seed',
        'AssessmentService',
      );
      throw new BusinessException(ErrorCode.REPORT_NOT_READY, REPORT_TEMPLATE_MISSING_MESSAGE);
    }

    const rendered = renderBlocks(
      loaded.blocks.map((block) => ({
        blockKey: block.blockKey,
        orderNo: block.orderNo,
        templateText: block.templateText,
        minChars: block.minChars,
      })),
      this.buildRenderContext(cache),
    );

    const missingKeys = [...new Set(rendered.flatMap((block) => block.missingKeys))];
    if (missingKeys.length > 0) {
      this.logger.warn(
        `报告模板存在未填充占位符（将原样展示）：templateId=${loaded.template.id} 键=${missingKeys.join('、')}`,
        'AssessmentService',
      );
    }

    const blocks: RenderedBlock[] = rendered.filter((block) => block.blockKey !== PAYWALL_BLOCK_KEY);
    const lockedHint = rendered.find((block) => block.blockKey === PAYWALL_BLOCK_KEY)?.text ?? null;

    return {
      sheetId: Number(sheet.id),
      scene: sheet.scene,
      scaleCode: bundle.scale.code,
      scaleName: bundle.scale.name,
      scaleVersion: bundle.version.version,
      scaleVersionId: Number(bundle.version.id),
      submittedAt: this.toIso(sheet.submittedAt),
      dimensions: cache.dimensions,
      blocks,
      lockedHint,
      baselineNotice: cache.baseline.triggered ? cache.baseline.message : null,
      lowQualityNotice: cache.quality.isLowQuality ? LOW_QUALITY_NOTICE_MESSAGE : null,
      quality: cache.quality,
      disclaimer: loaded.template.disclaimer,
      p16: cache.p16,
    };
  }

  /**
   * 报告模板占位符上下文
   * 单人简版刻意不含昵称与分数（价值感标准 §一「简版对照」：无昵称；ADR-004 决策 3.5），
   * 故当前仅 16 型报告用到「类型名」。
   */
  private buildRenderContext(cache: SheetScoresCache): RenderContext {
    const context: RenderContext = {};
    if (cache.p16) context['类型名'] = cache.p16.typeName;
    return context;
  }

  private async buildDetail(sheet: AnswerSheetEntity): Promise<AssessmentDetail> {
    const context = await this.loadContext(sheet);
    return {
      sheet: this.toSheetState(
        sheet,
        context.answers,
        context.skipped,
        context.bundle.engineQuestions,
        context.skippedQuestionCodes,
      ),
      paper: this.toPaper(context.bundle),
    };
  }

  private toSheetState(
    sheet: AnswerSheetEntity,
    answers: AnswerMap,
    skipped: string[],
    questions: ScaleQuestion[],
    skippedQuestionCodes: ReadonlySet<string>,
  ): SheetState {
    const progress = buildProgress(questions, answers, skippedQuestionCodes);
    return {
      id: Number(sheet.id),
      scene: sheet.scene,
      status: sheet.status,
      draftVersion: sheet.draftVersion,
      answeredCount: progress.answeredCount,
      totalCount: progress.totalCount,
      progressPercent: progress.progressPercent,
      answers,
      skippedDimensions: skipped,
      durationSec: sheet.durationSec,
      qualityFlag: sheet.qualityFlag,
      reportReady: sheet.status === SHEET_STATUS_SUBMITTED,
      startedAt: this.toIso(sheet.startedAt),
      submittedAt: this.toIso(sheet.submittedAt),
    };
  }

  private toPaper(bundle: ScaleBundle): Paper {
    return {
      scaleCode: bundle.scale.code,
      scaleName: bundle.scale.name,
      scaleVersionId: Number(bundle.version.id),
      scaleVersion: bundle.version.version,
      itemCount: bundle.version.itemCount,
      introText: bundle.version.introText,
      baselineIntroText: bundle.version.baselineIntroText,
      dimensions: toPaperDimensions(bundle.dimensions),
      questions: toPaperQuestions(bundle.questions, bundle.dimensions),
    };
  }

  /** 丢弃答案的告警（只记题号，不记答案内容，避免日志留存用户作答） */
  private warnIgnoredAnswers(sheetId: number, ignoredCodes: string[]): void {
    if (ignoredCodes.length === 0) return;
    this.logger.warn(
      `丢弃了 ${ignoredCodes.length} 条非法/越界答案（未知题号、取值越界或属于被跳过维度）：` +
        `sheetId=${sheetId} 题号=${this.previewCodes(ignoredCodes)}`,
      'AssessmentService',
    );
  }

  /** 题号列表预览（截断，避免超长日志与超长错误文案） */
  private previewCodes(codes: string[]): string {
    if (codes.length <= MISSING_CODE_PREVIEW_LIMIT) return codes.join('、');
    return `${codes.slice(0, MISSING_CODE_PREVIEW_LIMIT).join('、')} 等 ${codes.length} 题`;
  }

  private toIso(value: Date | null): string | null {
    return value ? new Date(value).toISOString() : null;
  }
}

/** 一次作答的快照上下文（题目定义 + 已存答案 + 跳过维度） */
interface SheetContext {
  bundle: ScaleBundle;
  answers: AnswerMap;
  skipped: string[];
  skippedQuestionCodes: Set<string>;
}
