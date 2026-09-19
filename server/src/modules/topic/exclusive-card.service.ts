import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { DoubleFlaggedItem } from '../../engines/report/double-report.engine.js';
import { P16_DIMENSION_CODES, P16_POLE_LABELS } from '../../engines/scale/scale.constants.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import { SCENE_P16, SCENE_SINGLE } from '../assessment/assessment.constants.js';
import { AssessmentService } from '../assessment/assessment.service.js';
import type { DimensionOutcome, SheetScoresCache } from '../assessment/assessment.types.js';
import { SensitiveWordService } from '../content/sensitive-word.service.js';
import { InviteService } from '../invite/invite.service.js';
import type { ReadyDoubleReportSource } from '../invite/invite.types.js';
import { EntitlementService } from '../payment/entitlement.service.js';
import { PRODUCT_STATUS_ON, PRODUCT_TOPIC_SINGLE_PREFIX } from '../payment/payment.constants.js';
import { ProductService } from '../payment/product.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ExclusiveCardEntity } from './entities/exclusive-card.entity.js';
import type { ExclusiveCardCheckResult } from './entities/exclusive-card.entity.js';
import { TopicCardEntity } from './entities/topic-card.entity.js';
import { TopicEntity } from './entities/topic.entity.js';
import { LlmNotConfiguredError, LlmService } from './llm.service.js';
import type { LlmMessage } from './llm.service.js';
import type { DuoPromptDivergence } from './prompts/exclusive-card-duo.prompt.js';
import { buildDuoPrompt } from './prompts/exclusive-card-duo.prompt.js';
import { buildSoloPrompt } from './prompts/exclusive-card-solo.prompt.js';
import {
  CARD_TYPE_ACTION,
  CARD_TYPE_COGNITION,
  EXCLUSIVE_CARD_LOCK_PREFIX,
  EXCLUSIVE_CARD_LOCK_TTL_SEC,
  EXCLUSIVE_CARD_MAX_ATTEMPTS,
  EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE,
  EXCLUSIVE_CARD_REASON_MODEL_ERROR,
  EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA,
  EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED,
  EXCLUSIVE_CARD_SOLO_INVITE_ID,
  EXCLUSIVE_CARD_STATUS_DEGRADED,
  EXCLUSIVE_CARD_STATUS_READY,
  EXCLUSIVE_CARD_STATUS_REJECTED,
  PROMPT_VERSION_DUO,
  PROMPT_VERSION_SOLO,
  SENSITIVE_SCOPE_EXCLUSIVE_CARD,
  TOPIC_STATUS_ON,
} from './topic.constants.js';
import type { ExclusiveCardView } from './topic.types.js';

/**
 * AI 专属卡服务（模块 7，《锦囊卡片流 v1.0》§9 + ADR-007 决策 4 + ADR-008）
 *
 * 职责：取数 → 构造 prompt → 调模型 → 禁词校验（最多 2 次）→ 降级拼装 → 落库缓存 → 审计
 *
 * ── 缓存归属（ADR-008 决策 5）────────────────────────────────────────────
 * 缓存键 = `(owner_uid, invite_id, topic_id)`，**一次 `resolveScope` 决定读哪一行**：
 *   - 有「报告已就绪」的双人测评 → 双人版，`owner_uid` = **邀请发起方**（不是点击者），
 *     故发起方与被邀请方点击时命中同一张卡；`requester_uid` 另记「谁触发的」。
 *   - 否则 → 单人版，`owner_uid` = 本人、`invite_id` = 0（哨兵值）。
 * ⚠️ 归属必须随每次读写一起出现在 where 条件里：单人不带 `owner_uid` 会让全站单人用户
 *   在同一议题上共用一行，后生成者覆盖前者 —— 那是把别人的专属建议展示给用户（隐私事故），
 *   不是缓存效率问题。库层由 `uk_owner_scope_topic` 兜底。
 *
 * ── 为什么「输入升级」不需要特判（ADR-008 附带决策 9）─────────────────────
 * 决策 9 允许「缓存为 solo 且当前已有就绪双人报告」时重新生成覆盖。本服务用
 * **按范围解析**实现它：单人卡落在 `(本人, 0, 议题)`，而此时的读取范围已是
 * `(发起方, 真实邀请, 议题)` —— 范围里没有行 = 自然走生成路径，旧单人卡按
 * 决策 5「不迁移、不合并，保留为历史」留在原地。无需一段「solo→duo 覆盖」的特判代码，
 * 成本上界同样是「每归属方每议题最多 2 次模型调用」（1 次 solo + 1 次 duo）。
 *
 * ── 安全自查（铁律 #6「恶意用户会怎么攻击这里」）────────────────────────
 *   1. **付费墙**：`locked` 时**不下发 content**（否则未解锁用户可直接读到付费内容）；
 *      解锁判定一律查 `entitlement`，端上传任何「已解锁」参数都不被采信（本服务不接收此类入参）。
 *   2. **串号**：见上「缓存归属」，读写恒带 `owner_uid`；库层唯一键兜底。
 *   3. **刷模型**：并发由 Redis 锁表达（拿不到锁直接返回 50004「正在生成」），
 *      已有内容直读缓存不再调模型 —— 单用户无法把模型调用刷成任意次。
 *   4. **模型原文不外泄**：连续命中禁词时只落命中词，原文不落库、不写日志、不下发，
 *      端上看到的是降级通用版（`status` 亦不外显，ADR-008 §九）。
 *   5. **prompt 注入**：注入的只有**结论**（类型名 / 维度分 / 题干与选项文案），
 *      不含原始答案数组、不含 uid、不含订单；昵称与答案即使含指令，出口仍过禁词校验。
 *   6. **跨用户取数**：双人版需读被邀请方的 16 型答卷。依据是宪法 L263
 *      「prompt 注入：双方维度得分、16 型类型、分歧题目及双方选项」+ §9.2 模板的
 *      `{typeA}`/`{typeB}`（甲方=发起方、乙方=被邀请方），且被邀请方在 R8 知情同意书下
 *      共同参与了该次双人测评；读到的只是**类型名 + 决策风格端点**，不含分数线与原始答案。
 */
@Injectable()
export class ExclusiveCardService {
  constructor(
    @InjectRepository(ExclusiveCardEntity)
    private readonly cardRepository: Repository<ExclusiveCardEntity>,
    @InjectRepository(TopicCardEntity)
    private readonly topicCardRepository: Repository<TopicCardEntity>,
    private readonly assessment: AssessmentService,
    private readonly invite: InviteService,
    private readonly entitlement: EntitlementService,
    private readonly product: ProductService,
    private readonly sensitiveWord: SensitiveWordService,
    private readonly llm: LlmService,
    private readonly redis: RedisService,
    private readonly audit: AuditLogService,
    private readonly logger: AppLogger,
  ) {}

  /** 读取专属卡（随议题详情一起下发，不触发生成） */
  async read(userId: number, topic: TopicEntity): Promise<ExclusiveCardView> {
    const scope = await this.resolveScope(userId);
    const card = await this.findByScope(scope, Number(topic.id));
    return this.toView(userId, topic, card);
  }

  /**
   * 生成专属卡（POST /api/v1/topics/:code/exclusive-card，用户点击触发）
   *
   * 幂等语义：已有内容直读缓存；缓存不存在才真正生成。
   * 生成失败一律**降级为通用版**（认知卡 + 行动卡拼装），不把失败抛给用户
   *   —— 唯一会抛的是「并发正在生成」（50004）与「无权益」（60002）。
   */
  async generate(
    userId: number,
    topic: TopicEntity,
    meta: ExclusiveCardRequestMeta,
  ): Promise<ExclusiveCardView> {
    if (!(await this.entitlement.hasTopic(userId, topic.code))) {
      throw new BusinessException(ErrorCode.ENTITLEMENT_REQUIRED);
    }

    const scope = await this.resolveScope(userId);
    const existing = await this.findByScope(scope, Number(topic.id));
    if (existing?.content) return this.toView(userId, topic, existing);

    // 并发（用户连点 / 端上重试）由锁表达：拿不到锁说明同范围已在生成中。
    // Redis 不可用时会返回 false → 这里同样报「正在生成」，与「下单占位」的降级取舍不同：
    // 本接口的可用性前提本就是登录态（会话强依赖 Redis），静默放行反而会刷出重复模型调用。
    const lockKey = `${EXCLUSIVE_CARD_LOCK_PREFIX}${scope.ownerUid}:${scope.inviteId}:${topic.id}`;
    if (!(await this.redis.setIfAbsent(lockKey, String(userId), EXCLUSIVE_CARD_LOCK_TTL_SEC))) {
      throw new BusinessException(ErrorCode.EXCLUSIVE_CARD_GENERATING);
    }

    let card: ExclusiveCardEntity | null;
    try {
      const input = await this.buildInput(userId, scope, topic);
      const outcome = await this.produce(input, topic);
      card = await this.persist(scope, topic, userId, outcome);

      await this.audit.record({
        actorType: 'user',
        actorId: userId,
        action: AuditAction.EXCLUSIVE_CARD_GENERATE,
        targetType: 'exclusive_card',
        targetId: String(topic.id),
        detail: {
          inviteId: scope.inviteId,
          topicCode: topic.code,
          promptVersion: scope.promptVersion,
          model: outcome.model,
          status: outcome.status,
          reason: outcome.checkResult.reason ?? null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent ?? null,
      });
    } finally {
      // 锁必须释放：否则同一用户在 TTL（60s）内无法重试，且 50004 的提示语没有意义
      await this.redis.del(lockKey);
    }

    return this.toView(userId, topic, card);
  }

  // ------------------------------------------------------------------ 缓存范围

  /**
   * 解析本次读写的缓存归属（ADR-008 决策 5 / 附带决策 9）
   * 有已就绪的双人报告 → 双人版（归属发起方）；否则单人版（归属本人）。
   *
   * 取数快照随 scope 一起返回：生成时不必二次查询，也让「读缓存用的归属」与
   *   「生成用的输入」来自同一次取数，不会出现两者指向不同邀请的错配。
   */
  private async resolveScope(userId: number): Promise<CardScope> {
    const source = await this.invite.findLatestReadyDoubleReport(userId);
    if (source) {
      return {
        ownerUid: source.initiatorUid,
        inviteId: source.inviteId,
        promptVersion: PROMPT_VERSION_DUO,
        source,
      };
    }
    return {
      ownerUid: userId,
      inviteId: EXCLUSIVE_CARD_SOLO_INVITE_ID,
      promptVersion: PROMPT_VERSION_SOLO,
      source: null,
    };
  }

  private findByScope(scope: CardScope, topicId: number): Promise<ExclusiveCardEntity | null> {
    return this.cardRepository.findOne({
      where: { ownerUid: scope.ownerUid, inviteId: scope.inviteId, topicId },
    });
  }

  // ------------------------------------------------------------------ 输入构造

  /** 取数并构造 prompt；数据不足以生成时返回 no_input（降级原因 no_dimension_data） */
  private buildInput(
    userId: number,
    scope: CardScope,
    topic: TopicEntity,
  ): Promise<GenerationInput> {
    return scope.source
      ? this.buildDuoInput(scope.source, topic)
      : this.buildSoloInput(userId, topic);
  }

  /**
   * 双人版：议题挂载维度中**差值最大**者为「该维度」（ADR-008 决策 2）
   * 该维度任一方未评估时跳过，继续在剩余挂载维度里挑；全部未评估则不具备生成条件。
   */
  private async buildDuoInput(
    source: ReadyDoubleReportSource,
    topic: TopicEntity,
  ): Promise<GenerationInput> {
    const selected = this.selectDuoDimension(topic, source);
    if (!selected) return { kind: 'no_input' };

    // 双方人格类型：各自「最近一次已交卷」的 16 型答卷（ADR-008 决策 1）；
    // 未做 16 型的一方为 null，prompt 侧整行省略（不编造）
    const [initiatorSheet, inviteeSheet] = await Promise.all([
      this.assessment.findLatestSubmittedSheet(source.initiatorUid, SCENE_P16),
      this.assessment.findLatestSubmittedSheet(source.inviteeUid, SCENE_P16),
    ]);

    return {
      kind: 'prompt',
      messages: buildDuoPrompt({
        topicTitle: topic.title,
        personaA: this.toPersona(initiatorSheet?.cache ?? null),
        personaB: this.toPersona(inviteeSheet?.cache ?? null),
        scoreA: selected.scoreA,
        scoreB: selected.scoreB,
        divergence: this.pickDivergence(source.flagged.scale, selected.dimensionCode),
      }),
    };
  }

  /**
   * 单人版：议题挂载维度顺序**第一个已评估**者为「该维度」（ADR-008 附带决策 8）
   * 无已交卷的单人答卷、或挂载维度全部未评估 → 不具备生成条件。
   */
  private async buildSoloInput(userId: number, topic: TopicEntity): Promise<GenerationInput> {
    const [singleSheet, p16Sheet] = await Promise.all([
      this.assessment.findLatestSubmittedSheet(userId, SCENE_SINGLE),
      this.assessment.findLatestSubmittedSheet(userId, SCENE_P16),
    ]);

    const dimension = this.selectSoloDimension(topic, singleSheet?.cache ?? null);
    if (!dimension || dimension.score === null) return { kind: 'no_input' };

    return {
      kind: 'prompt',
      messages: buildSoloPrompt({
        topicTitle: topic.title,
        persona: this.toPersona(p16Sheet?.cache ?? null),
        score: dimension.score,
      }),
    };
  }

  /**
   * 选双人版的「该维度」（ADR-008 决策 2）
   * 只在 `dimensionScores.dimensions`（双方均已评估）里找；差值相同取挂载顺序靠前者
   *   —— 严格大于才替换，保证同一输入必得同一结果（可复现）。
   */
  private selectDuoDimension(
    topic: TopicEntity,
    source: ReadyDoubleReportSource,
  ): { dimensionCode: string; scoreA: number; scoreB: number } | null {
    const byCode = new Map(
      source.dimensionScores.dimensions.map((row) => [row.dimensionCode, row]),
    );

    let best: { dimensionCode: string; scoreA: number; scoreB: number } | null = null;
    let bestGap = -1;
    for (const code of topic.mountDimensions ?? []) {
      const row = byCode.get(code);
      if (!row) continue;
      const gap = Math.abs(row.scoreA - row.scoreB);
      if (gap > bestGap) {
        best = { dimensionCode: code, scoreA: row.scoreA, scoreB: row.scoreB };
        bestGap = gap;
      }
    }
    return best;
  }

  /** 选单人版的「该维度」（ADR-008 附带决策 8）：挂载顺序第一个已评估且分数非空者 */
  private selectSoloDimension(
    topic: TopicEntity,
    cache: SheetScoresCache | null,
  ): DimensionOutcome | null {
    if (!cache) return null;
    const byCode = new Map(cache.dimensions.map((row) => [row.code, row]));
    for (const code of topic.mountDimensions ?? []) {
      const row = byCode.get(code);
      if (row?.evaluated && row.score !== null) return row;
    }
    return null;
  }

  /**
   * 选「分歧最大的题目」（ADR-008 决策 3）：所选维度内分差最大的量表题
   *
   * 报告侧已按维度分组并按分差降序取前 2（R2），此处仍显式排序 ——
   * 不依赖跨模块的排序约定，避免报告侧调整取数条数/顺序时这里静默取错题。
   * 该维度无量表题分歧（或分歧项缺选项文案）→ 返回 null，prompt 整段省略
   * （决策 3：不退回全报告最大值，否则「该维度得分」与「分歧题」指向两个维度，自相矛盾）。
   */
  private pickDivergence(
    items: DoubleFlaggedItem[],
    dimensionCode: string,
  ): DuoPromptDivergence | null {
    const item = items
      .filter((row) => row.dimensionCode === dimensionCode)
      .sort((a, b) => b.gap - a.gap)
      .find((row) => row.optionLabelA && row.optionLabelB);
    if (!item?.optionLabelA || !item.optionLabelB) return null;

    return {
      questionText: item.questionTitle,
      answerA: item.optionLabelA,
      answerB: item.optionLabelB,
    };
  }

  /** 人格类型描述：类型名 + 决策风格端点（ADR-008 决策 1，如「守序者（决策风格：感受倾向）」） */
  private toPersona(cache: SheetScoresCache | null): string | null {
    const p16 = cache?.p16;
    if (!p16) return null;

    const decision = p16.dimensions.find(
      (row) => row.dimensionCode === P16_DIMENSION_CODES.DECISION,
    );
    const poleLabel = decision
      ? P16_POLE_LABELS[P16_DIMENSION_CODES.DECISION]?.[decision.pole]
      : undefined;
    // 决策维度缺失/端点名缺失时只给类型名：仍是有用信息，不因少一个括号就整行省略
    return poleLabel ? `${p16.typeName}（决策风格：${poleLabel}）` : p16.typeName;
  }

  // ------------------------------------------------------------------ 生成

  /**
   * 产出内容（不落库）
   *
   * 重试口径（§9.3 / ADR-008 附带决策 1）：最多调模型 2 次（首次 + 重试 1 次），
   *   两次都失败/命中禁词才降级。`check_result.attempts` 记**实际模型调用次数**，
   *   用于核对「每归属方每议题最多 2 次调用」的成本上界。
   */
  private async produce(input: GenerationInput, topic: TopicEntity): Promise<GenerationOutcome> {
    if (input.kind === 'no_input') {
      return this.degrade(topic, EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA, {
        hits: [],
        attempts: 0,
        model: null,
      });
    }
    if (!this.llm.configured) {
      return this.degrade(topic, EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE, {
        hits: [],
        attempts: 0,
        model: null,
      });
    }

    const hits: string[] = [];
    let model: string | null = null;
    let attempts = 0;
    let failureReason: string = EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED;

    for (let attempt = 1; attempt <= EXCLUSIVE_CARD_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;

      let content: string;
      try {
        const completion = await this.llm.complete(input.messages);
        content = completion.content;
        model = completion.model;
      } catch (error) {
        // 模型故障与「未配置」要分开记：前者可重试，后者重试没有意义
        if (error instanceof LlmNotConfiguredError) {
          return this.degrade(topic, EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE, {
            hits,
            attempts,
            model,
          });
        }
        this.logger.warn(
          `专属卡模型调用失败（第 ${attempt} 次）：${error instanceof Error ? error.message : String(error)}`,
          'ExclusiveCardService',
        );
        failureReason = EXCLUSIVE_CARD_REASON_MODEL_ERROR;
        continue;
      }

      const hit = await this.sensitiveWord.match(content, SENSITIVE_SCOPE_EXCLUSIVE_CARD);
      if (!hit) {
        return {
          status: EXCLUSIVE_CARD_STATUS_READY,
          content,
          model,
          checkResult: { passed: true, hits, attempts },
        };
      }

      // ⚠️ 只记命中词，不记命中的上下文与模型原文（否则等于把违规内容二次落库）
      if (!hits.includes(hit)) hits.push(hit);
      failureReason = EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED;
      this.logger.warn(
        `专属卡命中禁词（第 ${attempt} 次）：word=${hit} topic=${topic.code}`,
        'ExclusiveCardService',
      );
    }

    return this.degrade(topic, failureReason, { hits, attempts, model });
  }

  /**
   * 降级为通用版（ADR-008 决策 4）：议题的认知卡 + 行动卡按 `order_no` 升序换行连接
   *
   * 为什么拼装这两类卡：正文已在 `topic_card` 里、已过 P7 审校、且与议题强相关 ——
   *   零新增文案风险，用户看到的仍是有用内容而不是报错（§九要求降级时端上无感）。
   * 两者都没有（运营删过卡，实际种子数据下不可达）→ `rejected` 且**不落库**：
   *   落一行没有内容的缓存会把用户永久卡在「无内容且不再重试」的死角。
   */
  private async degrade(
    topic: TopicEntity,
    reason: string,
    meta: { hits: string[]; attempts: number; model: string | null },
  ): Promise<GenerationOutcome> {
    const cards = await this.topicCardRepository.find({
      where: {
        topicId: topic.id,
        status: TOPIC_STATUS_ON,
        cardType: In([CARD_TYPE_COGNITION, CARD_TYPE_ACTION]),
      },
      order: { orderNo: 'ASC' },
    });
    const content = cards
      .map((card) => card.body.trim())
      .filter(Boolean)
      .join('\n');

    this.logger.warn(
      `专属卡降级：topic=${topic.code} reason=${reason} attempts=${meta.attempts} 有兜底内容=${content.length > 0}`,
      'ExclusiveCardService',
    );

    return {
      status: content ? EXCLUSIVE_CARD_STATUS_DEGRADED : EXCLUSIVE_CARD_STATUS_REJECTED,
      content: content || null,
      model: meta.model,
      checkResult: {
        passed: false,
        hits: meta.hits,
        attempts: meta.attempts,
        reason,
      },
    };
  }

  /** 落库（同范围覆盖写入）；无内容（rejected）时不落库，见 `degrade` 说明 */
  private async persist(
    scope: CardScope,
    topic: TopicEntity,
    requesterUid: number,
    outcome: GenerationOutcome,
  ): Promise<ExclusiveCardEntity | null> {
    if (outcome.status === EXCLUSIVE_CARD_STATUS_REJECTED) return null;

    const existing = await this.findByScope(scope, Number(topic.id));
    const entity =
      existing ??
      this.cardRepository.create({
        ownerUid: scope.ownerUid,
        inviteId: scope.inviteId,
        topicId: Number(topic.id),
      });

    entity.requesterUid = requesterUid;
    entity.content = outcome.content;
    // ⚠️ 只写 ready / degraded：写 pending 会在进程崩溃时留下一行无内容的占位，
    //    把用户永久卡在「生成中」（并发语义由 Redis 锁表达，见 topic.constants.ts）
    entity.status = outcome.status;
    entity.promptVersion = scope.promptVersion;
    entity.model = outcome.model;
    entity.checkResult = outcome.checkResult;
    entity.generatedAt = new Date();

    return this.cardRepository.save(entity);
  }

  // ------------------------------------------------------------------ 视图

  /**
   * 实体 → 端上视图
   *
   * 两条硬约束：
   *   1. **未解锁不下发 content**：否则锁形占位形同虚设（付费墙在服务端，不在端上）；
   *   2. `status` 与降级原因**不外显**（ADR-008 §九）：降级内容与模型内容在端上长一个样，
   *      只有 `ready` 与否 —— 用户不该感到「被降级对待」。
   */
  private async toView(
    userId: number,
    topic: TopicEntity,
    card: ExclusiveCardEntity | null,
  ): Promise<ExclusiveCardView> {
    const unlocked = await this.entitlement.hasTopic(userId, topic.code);
    const content = unlocked && card?.content ? card.content : null;

    return {
      locked: !unlocked,
      price: unlocked ? null : await this.resolvePrice(topic.code),
      ready: content !== null,
      content,
      generatedAt: content !== null && card?.generatedAt ? card.generatedAt.toISOString() : null,
    };
  }

  /**
   * 解锁价格（元，边界总表 E4：金额只信服务端）
   * 商品缺失或已下架返回 null：端上按「暂不可购买」处理，绝不下发 ¥0 造成「免费却要下单」的误导。
   */
  private async resolvePrice(topicCode: string): Promise<number | null> {
    const product = await this.product.findByCode(`${PRODUCT_TOPIC_SINGLE_PREFIX}${topicCode}`);
    if (!product || product.status !== PRODUCT_STATUS_ON) return null;
    return product.price;
  }
}

/** 请求来源（审计留痕用；C 端由 controller 用 `resolveClientIp` 构造） */
export interface ExclusiveCardRequestMeta {
  ip: string;
  userAgent?: string | null;
}

/** 缓存归属：一次读写的唯一范围（ADR-008 决策 5） */
interface CardScope {
  /** 双人版 = 邀请发起方 uid；单人版 = 本人 uid */
  ownerUid: number;
  /** 单人版为哨兵值 0 */
  inviteId: number;
  promptVersion: string;
  /** 双人版的取数快照；单人版为 null（随 scope 解析一次，避免重复取数） */
  source: ReadyDoubleReportSource | null;
}

/** 取数结果：要么可调模型，要么数据不足（降级 no_dimension_data） */
type GenerationInput = { kind: 'prompt'; messages: LlmMessage[] } | { kind: 'no_input' };

/** 一次生成的产出（尚未落库） */
interface GenerationOutcome {
  status: string;
  content: string | null;
  model: string | null;
  checkResult: ExclusiveCardCheckResult;
}
