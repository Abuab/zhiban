import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { EntitlementService } from '../payment/entitlement.service.js';
import type { SaveTopicProgressDto } from './dto/topic.dto.js';
import { ExclusiveCardService } from './exclusive-card.service.js';
import { TopicCardEntity, type TopicCardOption } from './entities/topic-card.entity.js';
import { TopicReadProgressEntity } from './entities/topic-read-progress.entity.js';
import { TopicEntity } from './entities/topic.entity.js';
import { TOPIC_CARD_MAX_ORDER_NO, TOPIC_STATUS_ON } from './topic.constants.js';
import type {
  TopicCardView,
  TopicDetailView,
  TopicListItem,
  TopicProgressAck,
} from './topic.types.js';

/** 议题可变字段快照（后台改动的审计留痕用；不含 id/code/updatedAt 等不可改字段） */
export interface TopicSnapshot {
  title: string;
  subtitle: string | null;
  mountDimensions: string[];
  orderNo: number;
  status: string;
}

/** 卡片可变字段快照（审计留痕用；`type` 不可改故列入以便对照） */
export interface TopicCardSnapshot {
  orderNo: number;
  type: string;
  title: string | null;
  body: string;
  copyable: boolean;
  options: TopicCardOption[] | null;
  status: string;
}

/** 后台议题编辑载荷（字段含义与取值校验见 AdminContentService） */
export interface TopicAdminPatch {
  title?: string;
  /** `null` = 清空副标题 */
  subtitle?: string | null;
  mountDimensions?: string[];
  orderNo?: number;
  status?: string;
}

/** 后台卡片编辑载荷（**卡片类型不可改**：改类型会让选项语义与新类型不匹配） */
export interface TopicCardAdminPatch {
  title?: string | null;
  body?: string;
  copyable?: boolean;
  options?: TopicCardOption[];
  orderNo?: number;
  status?: string;
}

export function toTopicSnapshot(topic: TopicEntity): TopicSnapshot {
  return {
    title: topic.title,
    subtitle: topic.subtitle,
    mountDimensions: topic.mountDimensions ?? [],
    orderNo: topic.orderNo,
    status: topic.status,
  };
}

export function toTopicCardSnapshot(card: TopicCardEntity): TopicCardSnapshot {
  return {
    orderNo: card.orderNo,
    type: card.cardType,
    title: card.title,
    body: card.body,
    copyable: card.copyable === 1,
    options: card.optionsJson,
    status: card.status,
  };
}

/**
 * 锦囊卡片流服务（模块 7，规格《锦囊卡片流 v1.0》§9.4/§9.5）
 *
 * 依赖方向：topic.service → exclusive-card.service（专属卡是最后一卡，随详情一起下发）。
 *   反向不依赖，避免 Nest 的循环依赖：专属卡服务需要议题信息时由本服务**传入实体**，
 *   而不是回头注入本服务。
 *
 * 安全自查（铁律 #6）：
 *   1. **付费墙**：卡片流本身免费可浏览（模块 7 完成标准「8 个议题可浏览」），
 *      付费墙只挡 AI 专属卡；`unlocked` 一律由服务端查 `entitlement` 得出（PRD-005 §1），
 *      端上传任何「已解锁」参数都不被采信（本服务不接收此类入参）。
 *   2. **下架内容**：`status != 'on'` 的议题与卡片不下发；但**已生成内容不追回**
 *      （ADR-007 决策 3 同款口径），故专属卡读缓存不校验议题状态。
 *   3. **进度伪造**：`last_order_no` 是端上报的展示位置，不承载业务判定（不代表解锁/完成度奖励），
 *      故只做上界校验 + 单调不减，不额外鉴权。
 */
@Injectable()
export class TopicService {
  constructor(
    @InjectRepository(TopicEntity)
    private readonly topicRepository: Repository<TopicEntity>,
    @InjectRepository(TopicCardEntity)
    private readonly cardRepository: Repository<TopicCardEntity>,
    @InjectRepository(TopicReadProgressEntity)
    private readonly progressRepository: Repository<TopicReadProgressEntity>,
    private readonly entitlement: EntitlementService,
    private readonly exclusiveCard: ExclusiveCardService,
    private readonly logger: AppLogger,
  ) {}

  /** 议题列表（GET /api/v1/topics） */
  async list(userId: number): Promise<TopicListItem[]> {
    const topics = await this.topicRepository.find({
      where: { status: TOPIC_STATUS_ON },
      order: { orderNo: 'ASC' },
    });
    if (topics.length === 0) return [];

    // 一次取全已解锁议题集合（含「全包」展开），避免逐条查询
    const unlockedCodes = await this.entitlement.topicSet(userId);
    const progressRows = await this.progressRepository.find({ where: { userId } });
    const progressByTopicId = new Map(progressRows.map((row) => [Number(row.topicId), row]));

    return topics.map((topic) => {
      const progress = progressByTopicId.get(Number(topic.id));
      return {
        code: topic.code,
        title: topic.title,
        subtitle: topic.subtitle,
        unlocked: unlockedCodes.has(topic.code),
        lastOrderNo: progress ? progress.lastOrderNo : 0,
        finished: (progress?.finished ?? 0) === 1,
        // 报告「待沟通区」按维度反查入口（规范增补一 §三）——列表侧一次带出，避免 N+1
        mountDimensions: topic.mountDimensions ?? [],
      };
    });
  }

  /**
   * 按编码取「可用」议题
   *
   * 「不存在」与「已下架」用不同错误码（50001 / 50002）：前者是脏链接，后者是运营动作，
   * 混在一起会让客服无法判断该让用户重进还是等上架（与邀请域「统一 10002 防枚举」的取舍不同 ——
   * 议题编码是公开内容标识、不承载隐私，没有必要隐藏存在性）。
   */
  async requireActiveByCode(code: string): Promise<TopicEntity> {
    const topic = await this.topicRepository.findOne({ where: { code } });
    if (!topic) throw new BusinessException(ErrorCode.TOPIC_NOT_FOUND);
    if (topic.status !== TOPIC_STATUS_ON) throw new BusinessException(ErrorCode.TOPIC_OFFLINE);
    return topic;
  }

  /** 议题详情 / 卡片流（GET /api/v1/topics/:code） */
  async getDetail(userId: number, code: string): Promise<TopicDetailView> {
    const topic = await this.requireActiveByCode(code);

    const cards = await this.cardRepository.find({
      where: { topicId: topic.id, status: TOPIC_STATUS_ON },
      order: { orderNo: 'ASC' },
    });
    const [progress, exclusiveCard] = await Promise.all([
      this.progressRepository.findOne({ where: { userId, topicId: topic.id } }),
      this.exclusiveCard.read(userId, topic),
    ]);

    return {
      code: topic.code,
      title: topic.title,
      subtitle: topic.subtitle,
      mountDimensions: topic.mountDimensions ?? [],
      cards: cards.map((card) => this.toCardView(card)),
      progress: {
        lastOrderNo: progress ? progress.lastOrderNo : 0,
        finished: (progress?.finished ?? 0) === 1,
      },
      exclusiveCard,
    };
  }

  /**
   * 上报阅读进度（PUT /api/v1/topics/:code/progress）
   *
   * 单调不减：端上滑回上一张卡、或两个设备的请求乱序到达，都不应把续看位置退回去
   *   （否则用户切设备后会从更早的位置重新看）。`finished` 一旦打卡不再取消。
   */
  async saveProgress(
    userId: number,
    code: string,
    dto: SaveTopicProgressDto,
  ): Promise<TopicProgressAck> {
    const topic = await this.requireActiveByCode(code);
    const existing = await this.progressRepository.findOne({
      where: { userId, topicId: topic.id },
    });

    const lastOrderNo = Math.max(existing ? existing.lastOrderNo : 0, dto.lastOrderNo);
    const finished = ((existing?.finished ?? 0) === 1 || dto.finished === true) ? 1 : 0;

    if (existing) {
      // 无变化时不写库：滑动会高频上报，避免无意义的行更新与 binlog 膨胀
      if (existing.lastOrderNo !== lastOrderNo || existing.finished !== finished) {
        await this.progressRepository.update({ id: existing.id }, { lastOrderNo, finished });
      }
    } else {
      await this.progressRepository.save(
        this.progressRepository.create({ userId, topicId: topic.id, lastOrderNo, finished }),
      );
    }

    return { code: topic.code, lastOrderNo, finished: finished === 1 };
  }

  private toCardView(card: TopicCardEntity): TopicCardView {
    return {
      orderNo: card.orderNo,
      type: card.cardType,
      title: card.title,
      body: card.body,
      copyable: card.copyable === 1,
      options: card.optionsJson,
    };
  }

  // ================================================================ 后台（CMS）
  //
  // 分工：本节的读写只做**数据层原子操作**（存在性、卡序唯一性）；
  //   面向运营的语义校验（挂载维度是真实维度、演练卡恰一个正确答案、可复制仅话术卡等）
  //   与审计留痕都在 `AdminContentService` —— admin 域单向依赖本模块，本模块不得反向 import。
  //
  // 与 C 端接口的两处刻意差异：
  //   1. **含已下架内容**：后台必须能编辑已下架议题/卡片，否则一按下架就失联，只能改库恢复
  //   2. **不做在架过滤**：`status` 是后台的输入（上下架开关），不是过滤条件

  /** 后台：分页取全部议题（含已下架） */
  async listForAdmin(params: {
    status?: string;
    keyword?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: TopicEntity[]; total: number }> {
    const builder = this.topicRepository.createQueryBuilder('topic');
    if (params.status) {
      builder.andWhere('topic.status = :status', { status: params.status });
    }
    if (params.keyword) {
      builder.andWhere('(topic.code LIKE :keyword OR topic.title LIKE :keyword)', {
        keyword: `%${params.keyword}%`,
      });
    }
    const [rows, total] = await builder
      .orderBy('topic.orderNo', 'ASC')
      // 卡序/排序可变且非唯一，补 id 兜底让分页稳定（否则同 orderNo 的行可能被跳过或重复）
      .addOrderBy('topic.id', 'ASC')
      .take(params.limit)
      .skip(params.offset)
      .getManyAndCount();
    return { rows, total };
  }

  /**
   * 后台：按编码取议题（含已下架）
   *
   * 与 `requireActiveByCode` 分开（不是重复实现）：后者对已下架议题抛 50002，
   * 若后台复用它，运营一下架就再也编辑不了该议题（连重新上架都做不到）。
   */
  async findByCodeForAdmin(code: string): Promise<TopicEntity> {
    const topic = await this.topicRepository.findOne({ where: { code } });
    if (!topic) throw new BusinessException(ErrorCode.TOPIC_NOT_FOUND);
    return topic;
  }

  /**
   * 后台：编辑议题（标题 / 副标题 / 挂载维度 / 排序 / 上下架）
   * ⚠️ 议题编码不可改：它是 `topic_single:<code>` 商品、报告入口反查与端上路径的共同锚点
   */
  async updateForAdmin(
    code: string,
    patch: TopicAdminPatch,
  ): Promise<{ before: TopicSnapshot; after: TopicEntity }> {
    const topic = await this.findByCodeForAdmin(code);
    const before = toTopicSnapshot(topic);

    if (patch.title !== undefined) topic.title = patch.title;
    if (patch.subtitle !== undefined) topic.subtitle = patch.subtitle;
    if (patch.mountDimensions !== undefined) topic.mountDimensions = patch.mountDimensions;
    if (patch.orderNo !== undefined) topic.orderNo = patch.orderNo;
    if (patch.status !== undefined) topic.status = patch.status;

    const saved = await this.topicRepository.save(topic);
    this.logger.log(
      `议题已更新：code=${code} 标题=${saved.title} 状态=${saved.status}`,
      'TopicService',
    );
    return { before, after: saved };
  }

  /** 后台：取议题下全部卡片（含已下架，按卡序升序） */
  async findCardsForAdmin(code: string): Promise<TopicCardEntity[]> {
    const topic = await this.findByCodeForAdmin(code);
    return this.cardRepository.find({ where: { topicId: topic.id }, order: { orderNo: 'ASC' } });
  }

  /** 后台：按卡序取单张卡片（含已下架）—— 卡序是后台的编辑定位键（同议题内唯一） */
  async findCardForAdmin(code: string, orderNo: number): Promise<TopicCardEntity> {
    const topic = await this.findByCodeForAdmin(code);
    const card = await this.cardRepository.findOne({ where: { topicId: topic.id, orderNo } });
    if (!card) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '卡片不存在');
    }
    return card;
  }

  /**
   * 后台：新增卡片
   *
   * 卡序由服务端追加到末尾，**不接受运营指定**：卡序是阅读进度（`last_order_no`）的锚点，
   * 手填一个已占用的卡序会让详情页顺序不确定、进度错位。
   */
  async createCardForAdmin(
    code: string,
    input: {
      type: string;
      body: string;
      title: string | null;
      copyable: boolean;
      options: TopicCardOption[] | null;
    },
  ): Promise<TopicCardEntity> {
    const topic = await this.findByCodeForAdmin(code);
    const last = await this.cardRepository.findOne({
      where: { topicId: topic.id },
      order: { orderNo: 'DESC' },
    });
    const orderNo = (last ? last.orderNo : 0) + 1;
    if (orderNo > TOPIC_CARD_MAX_ORDER_NO) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `卡片数量已达上限（${TOPIC_CARD_MAX_ORDER_NO} 张）`,
      );
    }

    const saved = await this.cardRepository.save(
      this.cardRepository.create({
        topicId: topic.id,
        orderNo,
        cardType: input.type,
        title: input.title,
        body: input.body,
        copyable: input.copyable ? 1 : 0,
        optionsJson: input.options,
        // 新增即上架：刚写的卡要能立刻在端上看到，下架是后续的显式动作
        status: TOPIC_STATUS_ON,
      }),
    );
    this.logger.log(
      `卡片已新增：topic=${code} 卡序=${orderNo} 类型=${input.type}`,
      'TopicService',
    );
    return saved;
  }

  /**
   * 后台：编辑卡片（正文 / 副标题 / 可复制 / 选项 / 卡序 / 上下架）
   *
   * 卡序改到已被占用的位置直接拒绝：`topic_card` 只有普通索引 `idx_topic_order`（非唯一键），
   * 数据库不会兜底，撞序后详情页会出现两张卡顺序不定。
   */
  async updateCardForAdmin(
    code: string,
    card: TopicCardEntity,
    patch: TopicCardAdminPatch,
  ): Promise<{ before: TopicCardSnapshot; after: TopicCardEntity }> {
    const before = toTopicCardSnapshot(card);

    if (patch.orderNo !== undefined && patch.orderNo !== card.orderNo) {
      const occupied = await this.cardRepository.findOne({
        where: { topicId: card.topicId, orderNo: patch.orderNo },
      });
      if (occupied) {
        throw new BusinessException(
          ErrorCode.PARAM_INVALID,
          `卡序 ${patch.orderNo} 已被占用（同议题内卡序必须唯一）`,
        );
      }
      card.orderNo = patch.orderNo;
    }
    if (patch.title !== undefined) card.title = patch.title;
    if (patch.body !== undefined) card.body = patch.body;
    if (patch.copyable !== undefined) card.copyable = patch.copyable ? 1 : 0;
    if (patch.options !== undefined) card.optionsJson = patch.options;
    if (patch.status !== undefined) card.status = patch.status;

    const saved = await this.cardRepository.save(card);
    this.logger.log(
      `卡片已更新：topic=${code} 卡序=${saved.orderNo} 类型=${saved.cardType} 状态=${saved.status}`,
      'TopicService',
    );
    return { before, after: saved };
  }
}
