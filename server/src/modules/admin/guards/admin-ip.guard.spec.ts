import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/constants/error-code.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { AppRequest } from '../../../common/types/request-context.js';
import { AuditLogService } from '../../audit/audit-log.service.js';
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

  /** 按配置域返回配置值：admin.allowedIps / admin.ipWhitelistEnabled / app.isProduction */
  const mockConfig = (
    allowedIps: string[],
    isProduction: boolean,
    whitelistEnabled = true,
  ): void => {
    config.get.mockImplementation((key: string) => {
      if (key === 'admin.allowedIps') return allowedIps;
      if (key === 'admin.ipWhitelistEnabled') return whitelistEnabled;
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

  it('白名单条目支持 CIDR 网段（精确地址与网段可混用）', async () => {
    mockConfig(['203.0.113.7', '198.51.100.0/24'], true);
    const guard = buildGuard();

    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '198.51.100.200' }))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '198.51.100.7' }))),
    ).resolves.toBe(true);
    // 落在网段外 → 仍拒绝
    await expect(
      guard.canActivate(createContext(buildRequest({ remoteAddress: '198.51.101.1' }))),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  describe('总开关 ADMIN_IP_WHITELIST_ENABLED', () => {
    it('关闭时放行：即使生产环境且白名单未命中', async () => {
      mockConfig(['198.51.100.7'], true, false);
      const guard = buildGuard();

      await expect(
        guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
      ).resolves.toBe(true);
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('关闭时放行：生产环境白名单为空也不再全拒', async () => {
      mockConfig([], true, false);
      const guard = buildGuard();

      await expect(
        guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
      ).resolves.toBe(true);
    });

    it('开启时行为不变（回归保护）', async () => {
      mockConfig(['198.51.100.7'], true, true);
      const guard = buildGuard();

      await expect(
        guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('配置缺失（undefined）按开启处理 —— 写错值不得变成敞开', async () => {
      // 刻意不返回 admin.ipWhitelistEnabled，模拟「漏配 / 键名写错」
      config.get.mockImplementation((key: string) => {
        if (key === 'admin.allowedIps') return ['198.51.100.7'];
        if (key === 'app.isProduction') return true;
        return undefined;
      });
      const guard = buildGuard();

      await expect(
        guard.canActivate(createContext(buildRequest({ remoteAddress: '203.0.113.9' }))),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('生产环境关闭时启动打 error 日志（明示已放弃第二道防线）', () => {
      mockConfig(['198.51.100.7'], true, false);
      buildGuard().onModuleInit();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('ADMIN_IP_WHITELIST_ENABLED=false'),
        undefined,
        'AdminIpGuard',
      );
    });
  });
});
