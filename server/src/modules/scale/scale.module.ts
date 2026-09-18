import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import { ScaleEntity } from './entities/scale.entity.js';
import { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import { ScaleVersionEntity } from './entities/scale-version.entity.js';
import { ScoringRuleEntity } from './entities/scoring-rule.entity.js';
import { ScaleSeedService } from './scale-seed.service.js';

/**
 * 量表域模块（模块 3）
 * 实体注册机制：与现有业务模块一致 —— TypeOrmModule.forFeature 声明本模块实体，
 *   根模块 database.module.ts 的 autoLoadEntities: true 会把 forFeature 的实体并入 DataSource
 * 接线说明：本模块不 import 进 AppModule（app.module.ts 由上游维护）；
 *   种子导入脚本以 ScaleModule 显式创建应用上下文（同时需带 DatabaseModule 与 LoggerModule）
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
  providers: [ScaleSeedService],
  exports: [ScaleSeedService],
})
export class ScaleModule {}
