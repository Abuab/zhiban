import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AppRequest } from '../../common/types/request-context.js';
import { resolveClientIp } from '../../common/utils/request-ip.util.js';
import { SaveTopicProgressDto } from './dto/topic.dto.js';
import { ExclusiveCardService } from './exclusive-card.service.js';
import { TopicService } from './topic.service.js';
import type { ExclusiveCardView, TopicDetailView, TopicListItem, TopicProgressAck } from './topic.types.js';

/**
 * 锦囊卡片流接口（模块 7，接口契约见 docs/api.md §15）
 * 全局前缀 /api + URI 版本 v1 → 实际路径 /api/v1/topics/*
 *
 * 鉴权：全部需要登录态（AuthGuard 全局生效）。卡片流本身**免费可浏览**，
 *   付费墙只挡 AI 专属卡（§9.1），故列表与详情不做权益校验。
 * 归属：阅读进度按 `user_id` 隔离；专属卡的缓存归属与权限判定全在服务端
 *   （`ExclusiveCardService`），端上传任何「已解锁 / 已读」参数都不被采信
 *   —— 本控制器也不接收这类入参。
 * 路由顺序：`GET :code` 与 `PUT :code/progress`、`POST :code/exclusive-card` 不在同一层级，
 *   无「固定段被当成 :code」的问题（列表接口无同级固定段）。
 */
@Controller('topics')
export class TopicController {
  constructor(
    private readonly topicService: TopicService,
    private readonly exclusiveCardService: ExclusiveCardService,
  ) {}

  /** 议题列表（含解锁态与续看位置） */
  @Get()
  list(@CurrentUser('id') userId: number): Promise<TopicListItem[]> {
    return this.topicService.list(userId);
  }

  /**
   * 议题详情 / 卡片流（一次拉齐卡片 + 进度 + 专属卡状态）
   *
   * 议题不存在返回 50001、已下架返回 50002（刻意区分：议题编码是公开内容标识，
   *   不承载隐私，客服需要能判断「让用户重进」还是「等上架」）。
   */
  @Get(':code')
  getDetail(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
  ): Promise<TopicDetailView> {
    return this.topicService.getDetail(userId, code);
  }

  /**
   * 上报阅读进度（§9.4 续看）
   *
   * ⚠️ 用 PUT 而非 PATCH：微信小程序 `wx.request` 的 method 合法值**不含 PATCH**。
   * 服务端单调不减（滑动回退/多端乱序都不会把续看位置退回去），且无变化时不写库。
   */
  @Put(':code/progress')
  saveProgress(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
    @Body() dto: SaveTopicProgressDto,
  ): Promise<TopicProgressAck> {
    return this.topicService.saveProgress(userId, code, dto);
  }

  /**
   * 生成 AI 专属卡（§9.1 用户点击触发；§9.3 同一归属同一议题只生成一次）
   *
   * 幂等：已有内容直读缓存，不重复调模型；并发（连点）返回 50004「正在生成」。
   * 模型不可用 / 命中禁词 / 数据不足一律**降级为通用版**并正常返回内容（不报错）。
   */
  @Post(':code/exclusive-card')
  @HttpCode(HttpStatus.OK)
  async generateExclusiveCard(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
    @Req() request: AppRequest,
  ): Promise<ExclusiveCardView> {
    const topic = await this.topicService.requireActiveByCode(code);
    return this.exclusiveCardService.generate(userId, topic, {
      // 审计与限流必须共用同一个「真实客户端 IP」口径（见 resolveClientIp 的说明）
      ip: resolveClientIp(request),
      userAgent: request.headers['user-agent'],
    });
  }
}
