import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentModule } from '../content/content.module.js';
import { AccountService } from './account.service.js';
import { NicknameReviewEntity } from './entities/nickname-review.entity.js';
import { UserEntity } from './entities/user.entity.js';

/**
 * 账号模块（模块 2）
 * 职责：用户建档、资料读写、昵称内容安全、审核池入池
 * 依赖：WechatService（@Global）、SensitiveWordService（内容域）
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, NicknameReviewEntity]), ContentModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
