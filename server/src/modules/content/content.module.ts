import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensitiveWordEntity } from './entities/sensitive-word.entity.js';
import { SensitiveWordService } from './sensitive-word.service.js';

/**
 * 内容域模块
 * 本模块（模块 2）只落地「本地敏感词兜底」；锦囊卡片流与专属卡（模块 7）后续在本模块扩展
 */
@Module({
  imports: [TypeOrmModule.forFeature([SensitiveWordEntity])],
  providers: [SensitiveWordService],
  exports: [SensitiveWordService],
})
export class ContentModule {}
