import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { RedisConfig } from '../../config/configuration.js';
import { JobTaskEntity } from './job-task.entity.js';
import { JobTaskService } from './job-task.service.js';
import { QUEUE_KEY_PREFIX } from './queue.constants.js';

/**
 * 队列基础设施模块（模块 5）
 *
 * 职责边界（刻意做窄）：
 *   - 只负责**注册连接**（复用既有 Redis 实例，同库不同 key 前缀隔离）
 *   - 只负责**任务台账**（job_task，D1 转人工工单）
 *   - **不注册任何队列与消费者**：队列由使用方各自 `BullModule.registerQueue`，
 *     消费者（@Processor）跟着业务域走，避免「基础设施反向依赖业务域」
 *
 * 规格依据：docs/adr/ADR-005.md 决策 4；architecture.md §1（报告生成 Worker BullMQ Consumer）
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([JobTaskEntity]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.get<RedisConfig>('redis') as RedisConfig;
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.db,
          },
          prefix: QUEUE_KEY_PREFIX,
        };
      },
    }),
  ],
  providers: [JobTaskService],
  exports: [JobTaskService],
})
export class QueueModule {}
