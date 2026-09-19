import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ShareMaterialDto } from './dto/invite.dto.js';
import { InviteService } from './invite.service.js';
import type { DoubleReportL3Material } from './invite.types.js';

/**
 * 分享版报告接口（模块 5，架构 §3.2）
 * 实际路径 /api/v1/reports/*
 *
 * 为什么挂在邀请域：L3 素材的可见性判定依赖邀请的参与方关系与报告的就绪状态，
 *   判定逻辑与 InviteService 同源（若放到报告域会造成 invite ↔ report 双向依赖）。
 * 权限：**仅发起方可生成**；被邀请方与非参与方一律按「报告不存在」响应（ADR-005 决策 1）。
 */
@Controller('reports')
export class ReportShareController {
  constructor(private readonly inviteService: InviteService) {}

  /**
   * 生成 L3 分享版长图**素材**（PRD-002 §7 POST /reports/:id/share-image）
   *
   * ADR-005 决策 4：P1 无对象存储，服务端只下发素材（标题/正向区块/水印/免责声明），
   *   长图由小程序端 canvas 合成 —— 服务端不落图片、不产生静态资源清理问题。
   * 内容范围：三个区块由 L3 模板固定，可勾选的只有共识项（selectedBlocks 传共识项题号，不传=全量）。
   */
  @Post(':id/share-image')
  @HttpCode(HttpStatus.OK)
  shareImage(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) reportId: number,
    @Body() dto: ShareMaterialDto,
  ): Promise<DoubleReportL3Material> {
    return this.inviteService.getShareMaterial(userId, reportId, dto);
  }
}
