import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/constants/error-code.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { AppRequest } from '../../../common/types/request-context.js';
import { AuditLogService } from '../audit-log.service.js';
import { AdminIpGuard } from './admin-ip.guard.js';

/**
 * 后台 IP 白名单守卫（ADR-003 决策 3）
 * 安全背景：Nginx 的 allow/deny 是第一层防线，但它不在代码发布流程内；
 *          本守卫是第二层，必须 fail-closed 且不能被 X-Forwarded-For 伪造绕过。
 */
describe('AdminIpGuard 后台 IP 白名单', () => {
  const config = { get: vi.fn() };
  const auditLog = { record: vi.fn() };
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };

  const createContext = (request: Partial<AppRequest>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    }) as unknown as ExecutionContext;

  const buildRequest = (input: {
    remoteAddress?: string;
    forwardedFor?: string;
  }): AppRequest =>
    ({
      path: '/api/admin/configs',
      headers: input.forwardedFor
        ? { 'x-forwarded-for': input.forwardedFor, 'user-agent': 'vitest' }
        : { 'user-agent': 'vitest' },
      socket: { remoteAddress: input.remoteAddress },
    }) as unknown as AppRequest;

  /** 按配置域返回配置值：admin.allowedIps / app.isProduction */
  const mockConfig = (allowedIps: string[], isProduction: boolean): void => {
    config.get.mockImplementation((key: string) => {
      if (key === 'admin.allowedIps') return allowedIps;
      if (key === 'app.isProduction') return isProduction;
      return undefined;
    });
  };

  const buildGuard = (): AdminIpGuard =>
    new AdminIpGuard(
      config as unknown as ConfigService,
      auditLog as unknown as AuditLogService,
      logger as unknown as AppLogger,
    );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('生产环境白名单为空 → 拒绝所有请求（fail-closed）并留痕', async () => {
    mockConfig([], true);
    const guard = buildGuard();

    await expect(guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))))
      .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_ip_denied', detail: expect.objectContaining({ reason: 'whitelist_empty' }) }),
    );
  });

  it('生产环境命中白名单 → 放行', async () => {
    mockConfig(['203.0.113.9'], true);
    const guard = buildGuard();

    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
    ).resolves.toBe(true);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('生产环境未命中白名单 → 拒绝并留痕', async () => {
    mockConfig(['198.51.100.7'], true);
    const guard = buildGuard();

    await expect(guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))))
      .rejects.toBeInstanceOf(BusinessException);

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin_ip_denied',
        detail: expect.objectContaining({ reason: 'ip_not_allowed' }),
        ip: '203.0.113.9',
      }),
    );
  });

  it('伪造 X-Forwarded-For 无法绕过白名单（公网直连不采信该头）', async () => {
    mockConfig(['198.51.100.7'], true);
    const guard = buildGuard();

    // 攻击者伪造 XFF 为白名单 IP，但直连地址不在白名单 → 仍拒绝
    await expect(
      guard.canActivate(
        createContext(
          buildRequest({ remoteAddress: '203.0.113.9', forwardedFor: '198.51.100.7' }),
        ),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('经本机反代转发时按真实客户端 IP 判定（XFF 最后一段）', async () => {
    mockConfig(['198.51.100.7'], true);
    const guard = buildGuard();

    await expect(
      guard.canActivate(
        createContext(
          buildRequest({ remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.9, 198.51.100.7' }),
        ),
      ),
    ).resolves.toBe(true);
  });

  it('非生产环境白名单为空 → 放行（便于本地开发）', async () => {
    mockConfig([], false);
    const guard = buildGuard();

    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '127.0.0.1' }))),
    ).resolves.toBe(true);
  });

  it('非生产环境已配白名单时同样生效（避免本地环境与生产行为不一致）', async () => {
    mockConfig(['198.51.100.7'], false);
    const guard = buildGuard();

    await expect(guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))))
      .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('生产环境启动时对空白名单打 error 日志（可自诊断）', () => {
    mockConfig([], true);
    buildGuard().onModuleInit();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_ALLOWED_IPS'),
      undefined,
      'AdminIpGuard',
    );
  });

  it('非生产环境启动时不打 error 日志', () => {
    mockConfig([], false);
    buildGuard().onModuleInit();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('拒绝时使用 IP_FORBIDDEN 错误码（便于区分是哪一层拦截）', async () => {
    mockConfig(['198.51.100.7'], true);
    const guard = buildGuard();

    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
    ).rejects.toMatchObject({ response: { code: ErrorCode.IP_FORBIDDEN } });
  });
});
