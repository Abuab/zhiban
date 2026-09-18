import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { AppRequest } from '../../../common/types/request-context.js';
import { AdminSessionService } from '../admin-session.service.js';
import { AdminUserEntity } from '../entities/admin-user.entity.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

/**
 * 后台鉴权守卫（ADR-003 决策 2）
 * 安全背景：后台与小程序两套鉴权必须物理隔离。本组用例锁定三条不可回退的约束：
 *   1. 只用后台密钥验签（与小程序 JWT_SECRET 无关）
 *   2. 载荷 typ 必须是 'admin'（防止跨体系令牌混用）
 *   3. 未绑定二次验证时，除 @AllowTotpUnbound() 接口外一律拒绝
 * 另注：与小程序 AuthGuard 不同，本守卫**没有**「Redis 异常降级放行」分支 ——
 *      后台是高权限入口，会话不可验证时必须拒绝。
 */
describe('AdminAuthGuard 后台鉴权', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const jwtService = { verifyAsync: vi.fn() };
  const sessionService = { validate: vi.fn() };
  const adminRepository = { findOne: vi.fn() };
  const config = { get: vi.fn() };
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };

  const buildGuard = (): AdminAuthGuard =>
    new AdminAuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      sessionService as unknown as AdminSessionService,
      adminRepository as unknown as Repository<AdminUserEntity>,
      config as unknown as ConfigService,
      logger as unknown as AppLogger,
    );

  const createContext = (request: Partial<AppRequest>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    }) as unknown as ExecutionContext;

  const requestWithToken = (token?: string): AppRequest =>
    ({
      path: '/api/admin/configs',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }) as unknown as AppRequest;

  const adminRecord = (overrides: Partial<AdminUserEntity> = {}): AdminUserEntity =>
    ({
      id: 7,
      username: 'ops',
      role: 'super',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      status: 'active',
      ...overrides,
    }) as AdminUserEntity;

  const validPayload = {
    sub: '7',
    username: 'ops',
    role: 'super',
    sid: 'session-1',
    typ: 'admin',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('admin-secret');
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue(validPayload);
    sessionService.validate.mockResolvedValue({ adminId: 7, username: 'ops', role: 'super', createdAt: 0 });
    adminRepository.findOne.mockResolvedValue(adminRecord());
  });

  it('缺少 Bearer 令牌 → 401', async () => {
    await expect(buildGuard().canActivate(createContext(requestWithToken()))).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('非 Bearer 认证头 → 401', async () => {
    const request = { headers: { authorization: 'Basic abc' } } as unknown as AppRequest;
    await expect(buildGuard().canActivate(createContext(request))).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('使用后台独立密钥验签（不依赖小程序 JWT_SECRET）', async () => {
    config.get.mockReturnValue('admin-secret');
    const guard = buildGuard();
    await guard.canActivate(createContext(requestWithToken('token-abc')));

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-abc', { secret: 'admin-secret' });
  });

  it('验签失败 → 401', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
    await expect(
      buildGuard().canActivate(createContext(requestWithToken('bad'))),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('令牌过期 → 20002（前端据此跳登录页）', async () => {
    const expired = new Error('jwt expired');
    expired.name = 'TokenExpiredError';
    jwtService.verifyAsync.mockRejectedValue(expired);

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('expired'))),
    ).rejects.toMatchObject({ response: { code: 20002 } });
  });

  it('载荷 typ 不是 admin（如小程序令牌）→ 拒绝', async () => {
    jwtService.verifyAsync.mockResolvedValue({ ...validPayload, typ: undefined });

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('user-token'))),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(sessionService.validate).not.toHaveBeenCalled();
  });

  it('会话不存在（已登出/过期）→ 20009', async () => {
    sessionService.validate.mockResolvedValue(null);

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('token-abc'))),
    ).rejects.toMatchObject({ response: { code: 20009 } });
  });

  it('Redis 会话校验异常 → 拒绝（无降级放行分支）', async () => {
    sessionService.validate.mockRejectedValue(new Error('redis down'));

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('token-abc'))),
    ).rejects.toThrow();
  });

  it('管理员已停用 → 403（已签发会话立即失效）', async () => {
    adminRepository.findOne.mockResolvedValue(adminRecord({ status: 'disabled' }));

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('token-abc'))),
    ).rejects.toMatchObject({ response: { code: 20008 } });
  });

  it('管理员已被删除 → 拒绝', async () => {
    adminRepository.findOne.mockResolvedValue(null);

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('token-abc'))),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('未绑定二次验证且接口未放行 → 20011（阻断配置读写）', async () => {
    adminRepository.findOne.mockResolvedValue(adminRecord({ totpSecret: null }));
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(
      buildGuard().canActivate(createContext(requestWithToken('token-abc'))),
    ).rejects.toMatchObject({ response: { code: 20011 } });
  });

  it('未绑定二次验证但接口标了 @AllowTotpUnbound() → 放行并注入 totpEnabled=false', async () => {
    adminRepository.findOne.mockResolvedValue(adminRecord({ totpSecret: null }));
    reflector.getAllAndOverride.mockReturnValue(true);
    const request = requestWithToken('token-abc');

    await expect(buildGuard().canActivate(createContext(request))).resolves.toBe(true);
    expect(request.admin).toMatchObject({ id: 7, username: 'ops', totpEnabled: false });
  });

  it('已绑定二次验证 → 放行并注入身份与 totpEnabled=true', async () => {
    const request = requestWithToken('token-abc');

    await expect(buildGuard().canActivate(createContext(request))).resolves.toBe(true);
    expect(request.admin).toMatchObject({
      id: 7,
      username: 'ops',
      role: 'super',
      sessionId: 'session-1',
      totpEnabled: true,
    });
  });

  it('身份注入到 request.admin，不污染 request.user（两套鉴权互不干扰）', async () => {
    const request = requestWithToken('token-abc');

    await buildGuard().canActivate(createContext(request));

    expect(request.admin).toBeDefined();
    expect(request.user).toBeUndefined();
  });
});
