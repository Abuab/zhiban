import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentModule } from '../assessment/assessment.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ContentModule } from '../content/content.module.js';
import { InviteModule } from '../invite/invite.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { ExclusiveCardEntity } from './entities/exclusive-card.entity.js';
import { TopicCardEntity } from './entities/topic-card.entity.js';
import { TopicReadProgressEntity } from './entities/topic-read-progress.entity.js';
import { TopicEntity } from './entities/topic.entity.js';
import { ExclusiveCardService } from './exclusive-card.service.js';
import { LlmService } from './llm.service.js';
import { TopicController } from './topic.controller.js';
import { TopicSeedService } from './topic-seed.service.js';
import { TopicService } from './topic.service.js';

/**
 * 内容域模块（模块 7，ADR-007 / ADR-008）
 *
 * 职责：
 *   - 锦囊卡片流：8 议题 + 卡片（坑/话术/演练/认知/行动）
 *   - AI 专属卡：用户点击生成、生成一次缓存、禁词校验、失败降级
 *   - 阅读进度：续看位置（§9.4）与「已学会」打卡
 *
 * 依赖方向（全部单向，无循环）：
 *   - payment：专属卡的解锁判定（`locked`）与价格（E4 金额唯一真源）
 *   - assessment：专属卡 prompt 的人格类型（`scene='p16'`）与单人维度分（`scene='single'`）
 *   - invite：专属卡双人版的「最近一份已就绪报告」取数与缓存归属（ADR-008 决策 5）
 *   - content：禁词校验（`scope = 'exclusive_card'`）
 *   - audit：§9.3「生成行为记入审计日志」
 *
 * 说明：`buildAdminRequestMeta` 那套 request meta 属后台专用，C 端审计来源信息
 *   由 `TopicController` 用 `resolveClientIp` 现场构造（见 `ExclusiveCardRequestMeta`）。
 *   `admin` 域在模块 8 反向依赖本模块做后台内容切片，故本模块不得 import AdminModule。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TopicEntity,
      TopicCardEntity,
      ExclusiveCardEntity,
      TopicReadProgressEntity,
    ]),
    AuditModule,
    PaymentModule,
    AssessmentModule,
    InviteModule,
    ContentModule,
  ],
  controllers: [TopicController],
  providers: [
    TopicService,
    ExclusiveCardService,
    // 大模型调用只服务本域（专属卡），故不单独成模块，随内容域一起装配
    LlmService,
    // TopicSeedService 仅供 `npm run topic:seed` 脚本通过 Nest 容器取用（与商品/报告模板种子同构）
    TopicSeedService,
  ],
  // 仅导出 TopicService：后台内容域切片（AdminModule）复用其议题/卡片的原子读写能力
  // 其余 provider（专属卡、LLM、种子）是 C 端内部实现，后台不应直接触碰
  exports: [TopicService],
})
export class TopicModule {}
