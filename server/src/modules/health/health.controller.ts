import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';

/**
 * 健康检查接口（无需登录，仍受限流保护）
 * GET /api/health        → 进程存活
 * GET /api/health/ready  → 依赖就绪（依赖异常返回 503，供负载均衡摘流量）
 *
 * VERSION_NEUTRAL：健康检查不随业务接口版本演进，保持 /api/health 稳定，
 * 避免升级 v2 时部署脚本/探针需要跟着改路径
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
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
