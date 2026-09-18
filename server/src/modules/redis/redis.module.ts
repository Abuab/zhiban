import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

/**
 * Redis 全局模块：会话缓存 / 答题草稿 / 报告缓存 / 限流计数 / 轻量队列
 * 声明为 @Global，业务模块无需重复 import
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
