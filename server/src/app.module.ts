import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { LoggerModule } from './common/logger/logger.module.js';
import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { ScaleModule } from './modules/scale/scale.module.js';
import { SysConfigModule } from './modules/sys-config/sys-config.module.js';
import { WechatModule } from './modules/wechat/wechat.module.js';

/**
 * 应用根模块
 * 分层（见 docs/architecture.md §2）：
 *   基础设施层：Config / Logger / Database / Redis / 全局守卫与过滤器
 *   领域引擎层：量表 / 计分 / 差值 / 模板 / 合规过滤（模块 3 起逐步接入）
 *   业务模块层：账号 / 单人测评 / 16 型 / 双人邀请 / 报告 / 锦囊 / 专属卡
 *
 * 说明：WechatModule / LoggerModule / RedisModule 为 @Global，但全局模块需在根模块被 import 一次才会注册
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),
    LoggerModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    WechatModule,
    HealthModule,
    AuthModule,
    SysConfigModule,
    ScaleModule,
    AdminModule,
  ],
  providers: [
    AllExceptionsFilter,
    // 守卫顺序即执行顺序：先鉴权拿到身份，再按 openid 限流（被邀请方/发起方各自独立计数）
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
