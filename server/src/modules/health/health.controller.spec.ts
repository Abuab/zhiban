import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController 健康检查', () => {
  let controller: HealthController;
  const healthService = {
    liveness: vi.fn(),
    readiness: vi.fn(),
  };

  const createResponse = () => ({ status: vi.fn() }) as unknown as Response;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('liveness 返回 ok 与运行时长', () => {
    healthService.liveness.mockReturnValue({
      status: 'ok',
      uptimeSec: 12,
      env: 'test',
      timestamp: '2026-09-18T00:00:00.000Z',
    });

    const result = controller.liveness();

    expect(result.status).toBe('ok');
    expect(result.uptimeSec).toBe(12);
  });

  it('依赖全部就绪时 readiness 返回 200', async () => {
    healthService.readiness.mockResolvedValue({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    const response = createResponse();

    const result = await controller.readiness(response);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(result.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('依赖异常时 readiness 返回 503 且标记 degraded', async () => {
    healthService.readiness.mockResolvedValue({
      status: 'degraded',
      checks: { database: 'down', redis: 'up' },
    });
    const response = createResponse();

    const result = await controller.readiness(response);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result.status).toBe('degraded');
  });
});
