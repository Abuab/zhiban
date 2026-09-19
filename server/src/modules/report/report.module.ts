import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScaleModule } from '../scale/scale.module.js';
import { DoubleReportRenderService } from './double-report-render.service.js';
import { ReportTemplateBlockEntity } from './entities/report-template-block.entity.js';
import { ReportTemplateEntity } from './entities/report-template.entity.js';
import { ReportEntity } from './entities/report.entity.js';
import { VisibilityLogEntity } from './entities/visibility-log.entity.js';
import { ReportRecordService } from './report-record.service.js';
import { ReportTemplateSeedService } from './report-template-seed.service.js';
import { ReportTemplateService } from './report-template.service.js';

/**
 * 报告域模块（模块 4 起，模块 5 扩展）
 * 规格依据：architecture.md §5「报告域」
 *
 * 对外能力：
 *   - ReportTemplateService：模板读取（渲染时读取，改文案零发版）
 *   - ReportTemplateSeedService：导入脚本写入侧
 *   - ReportRecordService：report / visibility_log 两张表的唯一出口（模块 5）
 *   - DoubleReportRenderService：三层报告正文渲染（模块 5）
 *
 * 依赖方向：report → scale（把 seed 的 scaleCode 解析成 scale_version_id）
 * 说明：双人报告的**生成编排**放在邀请域（invite），因为它的输入是邀请与答案快照；
 *       本模块只承载「报告本身」的落库与渲染，避免 invite ↔ report 互相 import。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportTemplateEntity,
      ReportTemplateBlockEntity,
      ReportEntity,
      VisibilityLogEntity,
    ]),
    ScaleModule,
  ],
  providers: [
    ReportTemplateService,
    ReportTemplateSeedService,
    ReportRecordService,
    DoubleReportRenderService,
  ],
  exports: [
    ReportTemplateService,
    ReportTemplateSeedService,
    ReportRecordService,
    DoubleReportRenderService,
  ],
})
export class ReportModule {}
