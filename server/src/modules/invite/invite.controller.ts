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
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import type { AssessmentDetail, SheetState } from '../assessment/assessment.types.js';
import { SaveAnswersDto, SubmitAssessmentDto } from '../assessment/dto/save-answers.dto.js';
import type {
  InviteCreateResult,
  InviteInitiatorView,
  InviteListItem,
  InviteProgressAck,
  InviteRemindResult,
  InviteReportView,
  InviteView,
} from './invite.types.js';
import { InviteService } from './invite.service.js';
import { CreateInviteDto, InviteConsentDto } from './dto/invite.dto.js';

/**
 * 双人邀请接口（模块 5，规格 PRD-002，接口契约见 docs/api.md）
 * 全局前缀 /api + URI 版本 v1 → 实际路径 /api/v1/invites/*
 *
 * 鉴权：全部需要登录态（AuthGuard 全局生效）。**邀请码不是鉴权凭证**，
 *   只是「找到这条邀请」的入口；能否操作一律由服务端按参与方身份判定。
 * 越权：所有 :id / :code 接口的「非参与方」与「不存在」返回同一响应（ADR-005 决策 1），
 *   不区分二者可避免「用自增 id 探测哪些邀请真实存在」的枚举 oracle。
 * 限流：邀请码查询挂 invite 具名阈值（边界总表 C8 防枚举）；
 *   创建另有服务端 Redis 冷却（防「取消后立刻重建」刷码），与接口限流互补。
 * 路由顺序：`mine` 必须声明在 `:code` 之前，否则会被当成邀请码匹配。
 */
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  /**
   * 创建双人邀请（PRD-002 §7 POST /invites；P1 免费故无支付节点）
   * 前置：发起方已完成同版本单人测评 + 当前没有进行中的邀请（ADR-005 决策 7）
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteCreateResult> {
    return this.inviteService.create(userId, dto);
  }

  /** 我的邀请列表（§5：历史报告永久可回看，含发起方与被邀请方两种视角） */
  @Get('mine')
  listMine(@CurrentUser('id') userId: number): Promise<InviteListItem[]> {
    return this.inviteService.listMine(userId);
  }

  /** 换人重邀（C7：仅对方拒绝同意、且本条未派生过新邀请，全流程限 1 次） */
  @Post(':id/replace')
  @HttpCode(HttpStatus.OK)
  replace(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) inviteId: number,
  ): Promise<InviteCreateResult> {
    return this.inviteService.replace(userId, inviteId);
  }

  /** 续期 7 天（C4：限 1 次；未过期与已过期都可，过期后会把状态复活到进行中） */
  @Post(':id/renew')
  @HttpCode(HttpStatus.OK)
  renew(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) inviteId: number,
  ): Promise<InviteInitiatorView> {
    return this.inviteService.renew(userId, inviteId);
  }

  /** 取消邀请（§3 异常分支 cancelled；已完成/已解锁不允许取消） */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) inviteId: number,
  ): Promise<InviteInitiatorView> {
    return this.inviteService.cancel(userId, inviteId);
  }

  /**
   * 提醒 TA 作答（§5 每邀请限 3 次）
   * ADR-005 决策 6：微信侧未送达（如对方未订阅）**不消耗次数**，故失败时抛错、成功才计数。
   */
  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  remind(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) inviteId: number,
  ): Promise<InviteRemindResult> {
    return this.inviteService.remind(userId, inviteId);
  }

  /**
   * 进入邀请（PRD-002 §7 GET /invites/:code）
   * C1：邀请码绑定**第一个完成授权登录的人**；第三人打开得到「该邀请已被接受」。
   * 发起方打开自己的链接返回发起方视角，且不占用被邀请方名额。
   */
  @Get(':code')
  @RateLimit({ profile: 'invite' })
  open(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
  ): Promise<InviteView> {
    return this.inviteService.open(userId, code);
  }

  /** 知情同意（R8 强制勾选；agreed=false 即拒绝 → declined，发起方可换人重邀 1 次） */
  @Post(':code/consent')
  @HttpCode(HttpStatus.OK)
  consent(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
    @Body() dto: InviteConsentDto,
  ): Promise<InviteView> {
    return this.inviteService.consent(userId, code, dto);
  }

  /** 打开/续答邀请答卷（先建卷再渲染；幂等，进入答题页前调用） */
  @Post(':code/sheet')
  @HttpCode(HttpStatus.OK)
  openSheet(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
  ): Promise<AssessmentDetail> {
    return this.inviteService.openSheet(userId, code);
  }

  /**
   * 保存邀请答题草稿（B1 断点续答 / A3 乐观锁）；answers 为增量合并
   *
   * ⚠️ 用 PUT 而非 PATCH：微信小程序 wx.request 的 method 合法值不含 PATCH
   *   （与单人测评 `PUT /assessments/:id/draft` 保持同一约定）。
   */
  @Put(':code/answers')
  saveDraft(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
    @Body() dto: SaveAnswersDto,
  ): Promise<SheetState> {
    return this.inviteService.saveDraft(userId, code, dto);
  }

  /**
   * 交卷（B5 锁定答案）→ 冻结被邀请方快照 → 双方齐备则入队生成报告（R6）
   * 端上据返回的 reportStatus 轮询 `GET :code/report`，无需额外通知接口。
   */
  @Post(':code/answers')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
    @Body() dto: SubmitAssessmentDto,
  ): Promise<InviteProgressAck> {
    return this.inviteService.submit(userId, code, dto);
  }

  /** 复用历史单人答案（C3 / R7）：以历史答案作为本次双人作答并直接完成，快照标注复用 */
  @Post(':code/reuse')
  @HttpCode(HttpStatus.OK)
  reuse(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
  ): Promise<InviteProgressAck> {
    return this.inviteService.reuse(userId, code);
  }

  /**
   * 读取对比报告（PRD-002 §7 GET /invites/:code/report）
   * R3 三层可见：发起方得 L1、被邀请方得 L2；R6 未就绪返回 pending/failed 供端上轮询。
   */
  @Get(':code/report')
  getReport(
    @CurrentUser('id') userId: number,
    @Param('code') code: string,
  ): Promise<InviteReportView> {
    return this.inviteService.getReport(userId, code);
  }
}
