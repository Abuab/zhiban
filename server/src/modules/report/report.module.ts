import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScaleModule } from '../scale/scale.module.js';
import { ReportTemplateBlockEntity } from './entities/report-template-block.entity.js';
import { ReportTemplateEntity } from './entities/report-template.entity.js';
import { ReportTemplateSeedService } from './report-template-seed.service.js';
import { ReportTemplateService } from './report-template.service.js';

/**
 * 报告域模块（模块 4 起）
 * 规格依据：architecture.md §5「报告域」= report_template / report_template_block
 * 依赖方向：report → scale（只读查询量表版本，用于把 seed 的 scaleCode 解析成 scale_version_id）
 * 对外能力：
 *   - ReportTemplateService：渲染侧读取
 *   - ReportTemplateSeedService：导入脚本写入侧
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReportTemplateEntity, ReportTemplateBlockEntity]), ScaleModule],
  providers: [ReportTemplateService, ReportTemplateSeedService],
  exports: [ReportTemplateService, ReportTemplateSeedService],
})
export class ReportModule {}
