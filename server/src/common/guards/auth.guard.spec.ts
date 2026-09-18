import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';
import type { AppRequest } from '../types/request-context.js';
import { AuthGuard } from './auth.guard.js';

describe('AuthGuard 登录态校验', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const jwtService = { verifyAsync: vi.fn() };
  let guard: AuthGuard;

  const createContext = (request: Partial<AppRequest>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    vi.resetAllMocks();
    guard = new AuthGuard(reflector as unknown as Reflector, jwtService as unknown as JwtService);
  });

  it('未登录访问受保护接口返回 401', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const error = await guard
      .canActivate(createContext({ headers: {} } as AppRequest))
      .catch((err: BusinessException) => err);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('@Public 标记的接口无 token 直接放行', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(createContext({ headers: {} } as AppRequest))).resolves.toBe(
      true,
    );
  });

  it('合法 token 解析出用户身份', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ sub: 7, openid: 'openid-7' });
    const request = { headers: { authorization: 'Bearer good-token' } } as unknown as AppRequest;

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 7, openid: 'openid-7' });
  });

  it('token 过期返回 TOKEN_EXPIRED', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const expired = new Error('jwt expired');
    expired.name = 'TokenExpiredError';
    jwtService.verifyAsync.mockRejectedValue(expired);
    const request = { headers: { authorization: 'Bearer expired-token' } } as unknown as AppRequest;

    const error = await guard
      .canActivate(createContext(request))
      .catch((err: BusinessException) => err);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((error as BusinessException).getResponse()).toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
    });
  });
});
