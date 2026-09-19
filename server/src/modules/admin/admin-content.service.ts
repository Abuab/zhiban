import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { DIMENSION_CODES } from '../../engines/scale/scale.constants.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import type { TopicCardOption } from '../topic/entities/topic-card.entity.js';
import type { TopicCardEntity } from '../topic/entities/topic-card.entity.js';
import type { TopicEntity } from '../topic/entities/topic.entity.js';
import {
  CARD_TYPE_COPYABLE,
  CARD_TYPE_QUIZ,
  TOPIC_CARD_BODY_MAX_LENGTH,
  TOPIC_CARD_TYPES,
} from '../topic/topic.constants.js';
import {
  TopicService,
  toTopicCardSnapshot,
  toTopicSnapshot,
  type TopicAdminPatch,
  type TopicCardAdminPatch,
} from '../topic/topic.service.js';
import type { AdminRequestMeta } from './admin.types.js';
import type {
  CreateTopicCardDto,
  UpdateTopicCardDto,
  UpdateTopicDto,
} from './dto/admin-content.dto.js';

/** 挂载维度白名单：与量表维度常量同源，避免后台写进一个报告侧永不出现的编码 */
const DIMENSION_CODE_SET = new Set<string>(Object.values(DIMENSION_CODES));

/** 选项 key 长度上限（正常是 A/B/C 单字符，8 足够宽松） */
const OPTION_KEY_MAX_LENGTH = 8;

/**
 * 后台内容域写操作（模块 7 后台切片）
 *
 * 为什么写操作集中在 admin 模块而不是 topic 模块：
 *   审计留痕（AuditLogService）与来源信息（AdminRequestMeta）属后台域职责，
 *   topic 域只提供「内容数据的原子读写」，不感知后台身份（与 AdminPaymentService 同构）。
 *
 * 规格依据：
 *   - 《配置项注册表》内容域：锦囊的议题、正文、挂载维度后台可配（宪法 P5，G1 验收「改一篇锦囊无需发版」）
 *   - 增补 v0.3 一：每张卡只承担一个功能、正文 ≤120 字
 *   - §9.4：长按复制只对话术卡生效；§9.5：CMS 每卡一条、演练卡含 options
 *
 * 安全自查（「运营误操作 / 恶意后会怎么造成损失」）：
 *   1. **改议题编码**：接口不接收 code（UpdateTopicDto 注释），杜绝「编码被改 → 已发权益指向空商品」
 *   2. **写坏卡片**：未知卡类型、非真实维度、演练卡选项结构错、超长正文一律**拒绝**而不是静默丢弃
 *      —— 静默写进库会让端上渲染空白卡或错误判分，而且没有任何报错线索
 *   3. **卡序撞车**：新增卡只允许追加到末尾；改卡序若目标位被占用则拒绝（见 TopicService.updateCardForAdmin）
 *   4. **误删内容**：不提供删除接口（只提供上下架），历史阅读进度与专属卡缓存都按卡序引用
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly topicService: TopicService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** 编辑议题（标题 / 副标题 / 挂载维度 / 排序 / 上下架） */
  async updateTopic(
    code: string,
    dto: UpdateTopicDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<TopicEntity> {
    const patch: TopicAdminPatch = {};

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '议题标题不能为空');
      }
      patch.title = title;
    }
    if (dto.subtitle !== undefined) {
      // 空字符串 = 清空副标题（列可空；端上对 null 与空串都不渲染）
      const subtitle = dto.subtitle.trim();
      patch.subtitle = subtitle === '' ? null : subtitle;
    }
    if (dto.mountDimensions !== undefined) {
      patch.mountDimensions = this.normalizeMountDimensions(dto.mountDimensions);
    }
    if (dto.orderNo !== undefined) patch.orderNo = dto.orderNo;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有需要更新的字段');
    }

    const { before, after } = await this.topicService.updateForAdmin(code, patch);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.TOPIC_UPDATE,
      targetType: 'topic',
      targetId: code,
      detail: { before, after: toTopicSnapshot(after) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return after;
  }

  /** 新增卡片（卡序由服务端追加到末尾） */
  async createCard(
    code: string,
    dto: CreateTopicCardDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<TopicCardEntity> {
    const type = dto.type.trim();
    this.assertCardType(type);

    const body = this.normalizeBody(dto.body);
    const copyable = this.resolveCopyable(type, dto.copyable);

    const options = dto.options === undefined ? null : this.normalizeOptions(type, dto.options);
    if (options === null && type === CARD_TYPE_QUIZ) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '演练卡必须提供选项');
    }

    const card = await this.topicService.createCardForAdmin(code, {
      type,
      body,
      title: this.normalizeCardTitle(dto.title),
      copyable,
      options,
    });

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.TOPIC_CARD_CREATE,
      targetType: 'topic_card',
      targetId: `${code}#${card.orderNo}`,
      detail: { after: toTopicCardSnapshot(card) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return card;
  }

  /**
   * 编辑卡片（正文 / 副标题 / 可复制 / 选项 / 卡序 / 上下架）
   *
   * 先取既有卡片再写：① 不存在要报「卡片不存在」而不是静默新建 ② 可复制与选项的合法性
   *   取决于**既有卡类型**（类型不可改），拿不到类型就无法校验。
   */
  async updateCard(
    code: string,
    orderNo: number,
    dto: UpdateTopicCardDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<TopicCardEntity> {
    const card = await this.topicService.findCardForAdmin(code, orderNo);

    const patch: TopicCardAdminPatch = {};

    if (dto.body !== undefined) patch.body = this.normalizeBody(dto.body);
    if (dto.title !== undefined) patch.title = this.normalizeCardTitle(dto.title);
    if (dto.copyable !== undefined) patch.copyable = this.resolveCopyable(card.cardType, dto.copyable);
    if (dto.options !== undefined) patch.options = this.normalizeOptions(card.cardType, dto.options);
    if (dto.orderNo !== undefined) patch.orderNo = dto.orderNo;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有需要更新的字段');
    }

    const { before, after } = await this.topicService.updateCardForAdmin(code, card, patch);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.TOPIC_CARD_UPDATE,
      targetType: 'topic_card',
      targetId: `${code}#${after.orderNo}`,
      detail: { before, after: toTopicCardSnapshot(after) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return after;
  }

  // ---------------------------------------------------------------- 语义校验

  private assertCardType(type: string): void {
    if (!TOPIC_CARD_TYPES.includes(type)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, `卡片类型不合法：${type}`);
    }
  }

  /** 正文归一：去首尾空白（话术卡要长按复制，尾部空白会被一起复制走），且不允许为空 */
  private normalizeBody(body: string): string {
    const normalized = body.trim();
    if (!normalized) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '卡片正文不能为空');
    }
    return normalized;
  }

  /** 卡片副标题（列可空）：未传或空串一律落 null，避免库里出现空串与 null 两种「没有副标题」 */
  private normalizeCardTitle(title: string | undefined): string | null {
    if (title === undefined) return null;
    const trimmed = title.trim();
    return trimmed === '' ? null : trimmed;
  }

  /** 可复制只对话术卡生效（§9.4）；其他类型勾选即拒绝，避免「端上能复制但不符合内容标准」 */
  private resolveCopyable(type: string, copyable: boolean | undefined): boolean {
    if (copyable === true && type !== CARD_TYPE_COPYABLE) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '只有话术卡支持长按复制');
    }
    return copyable === true;
  }

  private normalizeMountDimensions(raw: string[]): string[] {
    const result: string[] = [];
    for (const item of raw) {
      const code = item.trim();
      if (!DIMENSION_CODE_SET.has(code)) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `挂载维度不合法：${code}`);
      }
      // 去重：重复项会让报告页的入口映射出现重复计算（虽不重复渲染，但没必要留脏数据）
      if (!result.includes(code)) result.push(code);
    }
    return result;
  }

  /**
   * 严格校验演练卡选项（与端上渲染不同：这里**拒绝**非法结构，不静默丢弃）
   *
   * 三处必须拦住的错误：选项落在非演练卡上（端上不会渲染，等于内容丢失）、
   * 正确答案不是恰好一个（端上无法判分）、选项 key 重复（作答记录无法定位到选项）。
   */
  private normalizeOptions(type: string, raw: unknown[]): TopicCardOption[] {
    if (type !== CARD_TYPE_QUIZ) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '只有演练卡可以有选项');
    }

    const options = raw.map((item, index): TopicCardOption => {
      const position = `第 ${index + 1} 个选项`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}必须是对象`);
      }
      const record = item as Record<string, unknown>;

      const key = typeof record.key === 'string' ? record.key.trim() : '';
      if (!key || key.length > OPTION_KEY_MAX_LENGTH) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的 key 不合法`);
      }

      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!text) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的正文不能为空`);
      }
      if (text.length > TOPIC_CARD_BODY_MAX_LENGTH) {
        throw new BusinessException(
          ErrorCode.PARAM_INVALID,
          `${position}的正文超过 ${TOPIC_CARD_BODY_MAX_LENGTH} 字`,
        );
      }

      const explain = typeof record.explain === 'string' ? record.explain.trim() : '';
      if (!explain) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的解析不能为空`);
      }
      if (explain.length > TOPIC_CARD_BODY_MAX_LENGTH) {
        throw new BusinessException(
          ErrorCode.PARAM_INVALID,
          `${position}的解析超过 ${TOPIC_CARD_BODY_MAX_LENGTH} 字`,
        );
      }

      if (typeof record.correct !== 'boolean') {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的 correct 必须是布尔值`);
      }

      return { key, text, correct: record.correct, explain };
    });

    if (new Set(options.map((option) => option.key)).size !== options.length) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '选项 key 不能重复');
    }

    const correctCount = options.filter((option) => option.correct).length;
    if (correctCount !== 1) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `演练卡必须恰好有一个正确答案（当前 ${correctCount} 个）`,
      );
    }

    return options;
  }
}
