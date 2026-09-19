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
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AssessmentService } from './assessment.service.js';
import type {
  AssessmentDetail,
  AssessmentReport,
  ResumeSummary,
  SheetState,
} from './assessment.types.js';
import { SaveAnswersDto, SubmitAssessmentDto } from './dto/save-answers.dto.js';
import { CurrentAssessmentQueryDto, StartAssessmentDto } from './dto/start-assessment.dto.js';
import { SupplementAssessmentDto } from './dto/supplement-assessment.dto.js';

/**
 * 单人测评接口（模块 4，接口契约见 docs/api.md §12）
 * 全局前缀 /api + URI 版本 v1 → 实际路径 /api/v1/assessments/*
 *
 * 鉴权：全部需要登录态（AuthGuard 全局生效），且服务端逐个校验「答题卷属于本人」，
 *       非本人访问返回 10004（403），不区分「不存在」与「别人的卷」（隐私约束 2.4）。
 * 限流：沿用全局默认阈值（RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS，按 openid 计数），
 *       答题与保存草稿是高频交互，不再单独收紧。
 * 路由顺序：`current` 必须声明在 `:id` 之前，否则会被当成 id 参数匹配。
 */
@Controller('assessments')
export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  /**
   * 开始作答（已有进行中的草稿则续答，B1）
   * B6：交卷后再次调用会新建一份答题卷（重测），历史答卷不受影响
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser('id') userId: number,
    @Body() dto: StartAssessmentDto,
  ): Promise<AssessmentDetail> {
    return this.assessmentService.start(userId, dto.scene);
  }

  /** 续答入口摘要（入口展示「继续上次（已完成 32/76 题）」）；无草稿返回 data = null */
  @Get('current')
  getCurrent(
    @CurrentUser('id') userId: number,
    @Query() query: CurrentAssessmentQueryDto,
  ): Promise<ResumeSummary | null> {
    return this.assessmentService.getCurrent(userId, query.scene);
  }

  /** 答题页数据（状态 + 题目 + 卷首文案，一次拉齐） */
  @Get(':id')
  getDetail(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) sheetId: number,
  ): Promise<AssessmentDetail> {
    return this.assessmentService.getDetail(userId, sheetId);
  }

  /**
   * 保存草稿（断点续答 B1 / 弱网补传 B2 / 多端乐观锁 A3）；answers 为增量合并
   *
   * ⚠️ 用 PUT 而非 PATCH：微信小程序 wx.request 的 method 合法值只有
   *   OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT，**不含 PATCH**，
   *   用 PATCH 会导致小程序端请求直接失败。语义上「保存草稿」是幂等的整体提交，PUT 亦成立。
   */
  @Put(':id/draft')
  saveDraft(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) sheetId: number,
    @Body() dto: SaveAnswersDto,
  ): Promise<SheetState> {
    return this.assessmentService.saveDraft(userId, sheetId, dto);
  }

  /** 交卷（B5 锁定答案）→ 直接返回简版报告 */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) sheetId: number,
    @Body() dto: SubmitAssessmentDto,
  ): Promise<AssessmentReport> {
    return this.assessmentService.submit(userId, sheetId, dto);
  }

  /** 读取简版报告（未交卷返回 40005） */
  @Get(':id/report')
  getReport(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) sheetId: number,
  ): Promise<AssessmentReport> {
    return this.assessmentService.getReport(userId, sheetId);
  }

  /** 补答被跳过的敏感维度（B7 事后补答 / A-4，报告标记「补测」） */
  @Post(':id/supplement')
  @HttpCode(HttpStatus.OK)
  supplement(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) sheetId: number,
    @Body() dto: SupplementAssessmentDto,
  ): Promise<AssessmentReport> {
    return this.assessmentService.supplement(userId, sheetId, dto);
  }
}
