import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { RateLimitConfig } from '../../config/configuration.js';
import { AccountService } from '../account/account.service.js';
import type { UserEntity } from '../account/entities/user.entity.js';
import { RedisService } from '../redis/redis.service.js';
import { WechatService } from '../wechat/wechat.service.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 11,
    openid: 'openid-11',
    unionid: null,
    nickname: null,
    nicknameStatus: 'ok',
    avatarUrl: null,
    ageConfirmed: 0,
    privacyAgreedAt: null,
    privacyPolicyVersion: null,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  max: 120,
  inviteWindowMs: 60_000,
  inviteMax: 20,
  loginWindowMs: 60_000,
  loginIpMax: 60,
  loginOpenidMax: 20,
};

describe('AuthService 登录 / 会话 / 限流（A1 / A3 / A5）', () => {
  const wechat = { code2Session: vi.fn() };
  const account = {
    ensureUserByOpenid: vi.fn(),
    assertAccountUsable: vi.fn(),
    requireUsableUser: vi.fn(),
    toProfile: vi.fn((user: UserEntity) => ({
      id: user.id,
      nickname: user.nickname,
      nicknameStatus: user.nicknameStatus,
      avatarUrl: user.avatarUrl,
      ageConfirmed: user.ageConfirmed === 1,
      privacyAgreed: user.privacyAgreedAt !== null,
      privacyPolicyVersion: user.privacyPolicyVersion,
      createdAt: user.createdAt.toISOString(),
    })),
  };
  const session = { create: vi.fn(), revoke: vi.fn(), ttlSeconds: 2_592_000 };
  const jwtService = { signAsync: vi.fn() };
  const redis = { allowBySlidingWindow: vi.fn() };
  const config = { get: vi.fn(() => RATE_LIMIT) };
  const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };

  let service: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue(RATE_LIMIT);
    service = new AuthService(
      wechat as unknown as WechatService,
      account as unknown as AccountService,
      session as unknown as SessionService,
      jwtService as never,
      redis as unknown as RedisService,
      config as never,
      logger as unknown as AppLogger,
    );
  });

  it('登录成功：建档 + 创建会话 + 签发 token', async () => {
    wechat.code2Session.mockResolvedValue({ openid: 'openid-11', session_key: 'sk' });
    redis.allowBySlidingWindow.mockResolvedValue({ allowed: true, remaining: 1, resetAt: 0 });
    account.ensureUserByOpenid.mockResolvedValue({ user: makeUser(), isNew: true });
    session.create.mockResolvedValue({ sessionId: 'sid-1', expiresIn: 2_592_000 });
    jwtService.signAsync.mockResolvedValue('jwt-token');

    const result = await service.login({ code: 'code-1' }, { ip: '1.1.1.1' });

    expect(result.token).toBe('jwt-token');
    expect(result.isNewUser).toBe(true);
    expect(result.expiresIn).toBe(2_592_000);
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 11,
      openid: 'openid-11',
      sid: 'sid-1',
    });
  });

  it('同一账号重复登录：每次生成独立会话（A3 多设备不互踢）', async () => {
    wechat.code2Session.mockResolvedValue({ openid: 'openid-11', session_key: 'sk' });
    redis.allowBySlidingWindow.mockResolvedValue({ allowed: true, remaining: 1, resetAt: 0 });
    account.ensureUserByOpenid.mockResolvedValue({ user: makeUser(), isNew: false });
    session.create
      .mockResolvedValueOnce({ sessionId: 'sid-A', expiresIn: 2_592_000 })
      .mockResolvedValueOnce({ sessionId: 'sid-B', expiresIn: 2_592_000 });
    jwtService.signAsync.mockResolvedValue('jwt-token');

    await service.login({ code: 'code-1' }, {});
    await service.login({ code: 'code-1' }, {});

    expect(session.create).toHaveBeenCalledTimes(2);
    expect(session.revoke).not.toHaveBeenCalled();
  });

  it('触发 openid 维度限流返回 429（防刷登录）', async () => {
    wechat.code2Session.mockResolvedValue({ openid: 'openid-11', session_key: 'sk' });
    redis.allowBySlidingWindow.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 });

    const error = await service.login({ code: 'code-1' }, {}).catch((err) => err);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((error as BusinessException).getResponse()).toMatchObject({
      code: ErrorCode.RATE_LIMITED,
    });
    // 限流后不得建档/建会话
    expect(account.ensureUserByOpenid).not.toHaveBeenCalled();
    expect(session.create).not.toHaveBeenCalled();
  });

  it('限流计数失败（Redis 异常）时放行并告警', async () => {
    wechat.code2Session.mockResolvedValue({ openid: 'openid-11', session_key: 'sk' });
    redis.allowBySlidingWindow.mockRejectedValue(new Error('redis down'));
    account.ensureUserByOpenid.mockResolvedValue({ user: makeUser(), isNew: false });
    session.create.mockResolvedValue({ sessionId: 'sid-1', expiresIn: 2_592_000 });
    jwtService.signAsync.mockResolvedValue('jwt-token');

    await expect(service.login({ code: 'code-1' }, {})).resolves.toMatchObject({
      token: 'jwt-token',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('微信 code 失效时向上抛出业务错误（A5 前端可重试换码）', async () => {
    wechat.code2Session.mockRejectedValue(new BusinessException(ErrorCode.WX_CODE_INVALID));

    const error = await service.login({ code: 'bad-code' }, {}).catch((err) => err);

    expect((error as BusinessException).getResponse()).toMatchObject({
      code: ErrorCode.WX_CODE_INVALID,
    });
  });

  it('续期沿用同一 sessionId，不新建设备会话', async () => {
    account.requireUsableUser.mockResolvedValue(makeUser());
    jwtService.signAsync.mockResolvedValue('jwt-new');

    const result = await service.refresh({ sub: 11, openid: 'openid-11', sid: 'sid-A' });

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 11,
      openid: 'openid-11',
      sid: 'sid-A',
    });
    expect(session.create).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
  });

  it('退出登录只撤销当前会话', async () => {
    session.revoke.mockResolvedValue(undefined);

    const result = await service.logout({ sub: 11, openid: 'openid-11', sid: 'sid-A' });

    expect(session.revoke).toHaveBeenCalledWith('sid-A');
    expect(result.revoked).toBe(true);
  });
});
