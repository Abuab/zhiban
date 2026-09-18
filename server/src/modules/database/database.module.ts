import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DatabaseConfig } from '../../config/configuration.js';

/**
 * 数据库模块（MySQL 8）
 * 约束：
 * 1. synchronize 恒为 false —— 表结构由 docs/schema.sql 管理，禁止 ORM 自动改表（安全基线 §4）
 * 2. autoLoadEntities —— 各业务模块通过 TypeOrmModule.forFeature 注册实体，无需在此维护清单
 * 3. 连接失败即启动失败（fail fast），避免带病运行产生脏数据
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.get<DatabaseConfig>('database') as DatabaseConfig;
        return {
          type: 'mysql' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          charset: 'utf8mb4',
          timezone: '+08:00',
          synchronize: db.synchronize,
          logging: db.logging,
          autoLoadEntities: true,
          // 单机 4C4G，连接池不宜过大（规格《基础设施与部署方案》§2）
          extra: {
            connectionLimit: 20,
          },
          retryAttempts: 3,
          retryDelay: 3000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
