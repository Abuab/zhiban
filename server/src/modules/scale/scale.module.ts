import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import { ScaleEntity } from './entities/scale.entity.js';
import { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import { ScaleVersionEntity } from './entities/scale-version.entity.js';
import { ScoringRuleEntity } from './entities/scoring-rule.entity.js';
import { ScaleQueryService } from './scale-query.service.js';
import { ScaleSeedService } from './scale-seed.service.js';

/**
 * 量表域模块（模块 3）
 * 实体注册机制：与现有业务模块一致 —— TypeOrmModule.forFeature 声明本模块实体，
 *   根模块 database.module.ts 的 autoLoadEntities: true 会把 forFeature 的实体并入 DataSource
 * 对外能力：
 *   - ScaleSeedService：导入脚本写入侧
 *   - ScaleQueryService：报告域 / 测评域读取侧（含实体 → L1 引擎纯数据的转换）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScaleEntity,
      ScaleVersionEntity,
      ScaleDimensionEntity,
      ScaleQuestionEntity,
      ScoringRuleEntity,
    ]),
  ],
  providers: [ScaleSeedService, ScaleQueryService],
  exports: [ScaleSeedService, ScaleQueryService],
})
export class ScaleModule {}
