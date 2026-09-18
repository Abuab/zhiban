import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './app-logger.service.js';

/**
 * 日志全局模块：AppLogger 需被基础设施层（Redis/数据库/守卫/过滤器）复用，
 * 因此单独抽为 @Global 模块，避免各模块重复声明
 */
@Global()
@Module({
  providers: [
    {
      provide: AppLogger,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AppLogger(config.get<string>('app.logLevel') ?? 'log'),
    },
  ],
  exports: [AppLogger],
})
export class LoggerModule {}
