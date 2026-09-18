import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service.js';

export interface LivenessResult {
  status: 'ok';
  uptimeSec: number;
  env: string;
  timestamp: string;
}

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

/**
 * 健康检查：liveness 用于进程存活探测，readiness 用于依赖（MySQL / Redis）就绪探测
 * 依据《基础设施与部署方案》§1：PM2 守护 + 依赖就绪后才接流量
 */
@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  liveness(): LivenessResult {
    return {
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
      env: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResult> {
    const [databaseUp, redisUp] = await Promise.all([this.checkDatabase(), this.redis.ping()]);
    return {
      status: databaseUp && redisUp ? 'ok' : 'degraded',
      checks: {
        database: databaseUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
