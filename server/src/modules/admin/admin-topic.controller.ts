import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import type { TopicCardOption } from '../topic/entities/topic-card.entity.js';
import type { TopicCardEntity } from '../topic/entities/topic-card.entity.js';
import type { TopicEntity } from '../topic/entities/topic.entity.js';
import { TopicService } from '../topic/topic.service.js';
import { AdminContentService } from './admin-content.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import {
  CreateTopicCardDto,
  QueryAdminTopicDto,
  UpdateTopicCardDto,
  UpdateTopicDto,
} from './dto/admin-content.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/** 后台议题视图（含已下架） */
interface AdminTopicItem {
  id: number;
  code: string;
  title: string;
  subtitle: string | null;
  mountDimensions: string[];
  orderNo: number;
  status: string;
  updatedAt: string;
}

/** 后台卡片视图（含已下架，含 `options` 原始结构供编辑回填） */
interface AdminTopicCardItem {
  id: number;
  orderNo: number;
  type: string;
  title: string | null;
  body: string;
  copyable: boolean;
  options: TopicCardOption[] | null;
  status: string;
  updatedAt: string;
}

interface AdminTopicListResult {
  items: AdminTopicItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 后台内容域接口（模块 7 后台切片，接口契约见 docs/api.md §16）
 * 实际路径：/api/admin/topics*
 *
 * ⚠️ VERSION_NEUTRAL 的理由同 AdminAuthController：避免被 defaultVersion='1' 加成 /api/v1/admin/**（会整站静默 404）。
 * ⚠️ @Public() 与 @UseGuards(AdminIpGuard, AdminAuthGuard) 必须成对出现：只标 @Public() 是 fail-open。
 *
 * 能力边界（对齐 G1 验收「运营改一道题、改价格、下架一篇锦囊均无需发版」）：
 *   - 提供「议题列表 / 编辑议题 / 卡片列表 / 新增卡片 / 编辑卡片」
 *   - **不支持新增/删除议题**：议题编码是 `topic_single:<code>` 商品与报告入口的锚点，
 *     且议题由种子脚本按 `topic.constants.ts` 生成；运营误建/误删会让端上入口指向空内容
 *   - **不支持删除卡片**：只提供上下架 —— 历史阅读进度与专属卡缓存都按卡序引用
 *   - **不支持改卡片类型**：改类型会让既有选项语义与新类型不匹配（见 UpdateTopicCardDto 注释）
 *   - 卡序新增只追加到末尾；编辑时改到一个已占用的卡序会被拒绝（服务层校验）
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/topics', version: VERSION_NEUTRAL })
export class AdminTopicController {
  constructor(
    private readonly topicService: TopicService,
    private readonly adminContentService: AdminContentService,
  ) {}

  /** 议题分页列表（含已下架） */
  @Get()
  async list(@Query() query: QueryAdminTopicDto): Promise<AdminTopicListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { rows, total } = await this.topicService.listForAdmin({
      status: query.status,
      keyword: query.keyword,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items: rows.map((row) => toTopicItem(row)), total, page, pageSize };
  }

  /** 编辑议题（标题 / 副标题 / 挂载维度 / 排序 / 上下架），变更写 audit_log */
  @Put(':code')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('code') code: string,
    @Body() dto: UpdateTopicDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<AdminTopicItem> {
    const updated = await this.adminContentService.updateTopic(
      code,
      dto,
      admin,
      buildAdminRequestMeta(request),
    );
    return toTopicItem(updated);
  }

  /** 议题下的卡片列表（含已下架，按卡序升序）—— 后台编辑器据此渲染卡片清单 */
  @Get(':code/cards')
  async listCards(@Param('code') code: string): Promise<AdminTopicCardItem[]> {
    const cards = await this.topicService.findCardsForAdmin(code);
    return cards.map((card) => toCardItem(card));
  }

  /**
   * 新增卡片（卡序由服务端追加到末尾）
   * ⚠️ 微信小程序 `wx.request` 无 PATCH，编辑一律 PUT，故这里用 POST 表达「新建」语义
   */
  @Post(':code/cards')
  @HttpCode(HttpStatus.OK)
  async createCard(
    @Param('code') code: string,
    @Body() dto: CreateTopicCardDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<AdminTopicCardItem> {
    const card = await this.adminContentService.createCard(
      code,
      dto,
      admin,
      buildAdminRequestMeta(request),
    );
    return toCardItem(card);
  }

  /** 编辑卡片（正文 / 副标题 / 可复制 / 选项 / 卡序 / 上下架），变更写 audit_log */
  @Put(':code/cards/:orderNo')
  @HttpCode(HttpStatus.OK)
  async updateCard(
    @Param('code') code: string,
    @Param('orderNo', ParseIntPipe) orderNo: number,
    @Body() dto: UpdateTopicCardDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<AdminTopicCardItem> {
    const card = await this.adminContentService.updateCard(
      code,
      orderNo,
      dto,
      admin,
      buildAdminRequestMeta(request),
    );
    return toCardItem(card);
  }
}

function toTopicItem(topic: TopicEntity): AdminTopicItem {
  return {
    id: topic.id,
    code: topic.code,
    title: topic.title,
    subtitle: topic.subtitle,
    mountDimensions: topic.mountDimensions ?? [],
    orderNo: topic.orderNo,
    status: topic.status,
    updatedAt: topic.updatedAt.toISOString(),
  };
}

function toCardItem(card: TopicCardEntity): AdminTopicCardItem {
  return {
    id: card.id,
    orderNo: card.orderNo,
    type: card.cardType,
    title: card.title,
    body: card.body,
    copyable: card.copyable === 1,
    options: card.optionsJson,
    status: card.status,
    updatedAt: card.updatedAt.toISOString(),
  };
}
