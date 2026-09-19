import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module.js';
import { AssessmentModule } from '../assessment/assessment.module.js';
import { INVITE_EXPIRE_QUEUE, REPORT_GENERATE_QUEUE } from '../queue/queue.constants.js';
import { ReportModule } from '../report/report.module.js';
import { ScaleModule } from '../scale/scale.module.js';
import { DoubleReportGeneratorService } from './double-report-generator.service.js';
import { AnswerSnapshotEntity } from './entities/answer-snapshot.entity.js';
import { InviteEntity } from './entities/invite.entity.js';
import { InviteController } from './invite.controller.js';
import { InviteExpireProcessor } from './invite-expire.processor.js';
import { InviteExpireScheduler } from './invite-expire.scheduler.js';
import { InviteService } from './invite.service.js';
import { ReportGenerateProcessor } from './report-generate.processor.js';
import { ReportShareController } from './report-share.controller.js';

/**
 * 双人邀请域模块（模块 5，规格 PRD-002）
 *
 * 职责：
 *   - 邀请状态机（C1 绑定首个授权人 / C3 复用 / C4 过期续期 / C7 换人 / C8 邀请码）
 *   - 双方答案快照的冻结（B8 不可变）
 *   - 三层可见性取数（R3：L1 发起方 / L2 被邀请方 / L3 分享素材）
 *   - 报告生成的**编排**（入队 + Worker），报告本身的落库与渲染在报告域（report.module）
 *
 * 队列说明：QueueModule 已在根模块注册（@Global），此处只需 `BullModule.registerQueue`
 *   声明本域用到的队列；消费者（@Processor）跟着业务域走 ——
 *   这样「邀请域 → 报告域」保持单向依赖，不出现基础设施反向依赖业务域。
 *
 * 依赖方向：invite → assessment（答卷读写）/ report（报告落库与渲染）/ scale（量表版本）/ account（昵称）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InviteEntity, AnswerSnapshotEntity]),
    BullModule.registerQueue({ name: REPORT_GENERATE_QUEUE }, { name: INVITE_EXPIRE_QUEUE }),
    ScaleModule,
    ReportModule,
    AssessmentModule,
    AccountModule,
  ],
  controllers: [InviteController, ReportShareController],
  providers: [
    InviteService,
    DoubleReportGeneratorService,
    ReportGenerateProcessor,
    InviteExpireScheduler,
    InviteExpireProcessor,
  ],
})
export class InviteModule {}
