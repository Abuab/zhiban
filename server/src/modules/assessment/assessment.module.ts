import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportModule } from '../report/report.module.js';
import { ScaleModule } from '../scale/scale.module.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentService } from './assessment.service.js';
import { AnswerSheetEntity } from './entities/answer-sheet.entity.js';

/**
 * 单人测评模块（模块 4）
 * 职责：答题流程（断点续答 / 进度 / 敏感维度前置同意）、交卷计分落库、简版报告、补答
 * 依赖：ScaleModule（量表快照读取）、ReportModule（报告模板读取）
 * 说明：只有本模块写 answer_sheet；模块 5（双人邀请）通过本模块的能力创建 scene=invite 的答卷
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnswerSheetEntity]),
    ScaleModule,
    ReportModule,
  ],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
