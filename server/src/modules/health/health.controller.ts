import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';

/**
 * 健康检查接口（无需登录，仍受限流保护）
 * GET /api/health        → 进程存活
 * GET /api/health/ready  → 依赖就绪（依赖异常返回 503，供负载均衡摘流量）
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  liveness(): LivenessResult {
    return this.healthService.liveness();
  }

  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResult> {
    const result = await this.healthService.readiness();
    response.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
