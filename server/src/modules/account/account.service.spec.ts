import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { SensitiveWordService } from '../content/sensitive-word.service.js';
import { WechatService } from '../wechat/wechat.service.js';
import { AccountService } from './account.service.js';
import type { NicknameReviewEntity } from './entities/nickname-review.entity.js';
import { UserEntity } from './entities/user.entity.js';

/** 构造一个可用用户 */
function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 1,
    openid: 'openid-1',
    unionid: null,
    nickname: '原昵称',
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

describe('AccountService 账号与昵称内容安全（A1 / A6）', () => {
  const userRepository = {
    findOne: vi.fn(),
    create: vi.fn((input: Partial<UserEntity>) => input),
    save: vi.fn(),
    update: vi.fn(),
  };
  const nicknameReviewRepository = {
    findOne: vi.fn(),
    create: vi.fn((input: Partial<NicknameReviewEntity>) => input),
    save: vi.fn(),
  };
  const wechat = { checkText: vi.fn() };
  const sensitiveWord = { match: vi.fn() };
  const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };

  let service: AccountService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AccountService(
      userRepository as never,
      nicknameReviewRepository as never,
      wechat as unknown as WechatService,
      sensitiveWord as unknown as SensitiveWordService,
      logger as unknown as AppLogger,
    );
  });

  describe('建档幂等（A1：openid 不变则权益与记录自动跟随）', () => {
    it('openid 已存在时返回既有账号且不新建', async () => {
      const existing = makeUser();
      userRepository.findOne.mockResolvedValue(existing);

      const result = await service.ensureUserByOpenid({ openid: 'openid-1' });

      expect(result.isNew).toBe(false);
      expect(result.user).toBe(existing);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('已有账号补 unionid 但不新建账号', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      const result = await service.ensureUserByOpenid({ openid: 'openid-1', unionid: 'union-1' });

      expect(result.isNew).toBe(false);
      expect(userRepository.update).toHaveBeenCalledWith(1, { unionid: 'union-1' });
    });

    it('首次登录建档 isNew=true', async () => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.save.mockResolvedValue(makeUser({ id: 9 }));

      const result = await service.ensureUserByOpenid({ openid: 'openid-new' });

      expect(result.isNew).toBe(true);
      expect(userRepository.save).toHaveBeenCalledTimes(1);
    });

    it('并发首登撞唯一键（ER_DUP_ENTRY）时回读既有账号，保证幂等', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeUser({ id: 3 }));
      const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      userRepository.save.mockRejectedValue(duplicate);

      const result = await service.ensureUserByOpenid({ openid: 'openid-race' });

      expect(result.isNew).toBe(false);
      expect(result.user.id).toBe(3);
    });
  });

  describe('昵称内容安全（A6：违规进审核池而非直接拒绝）', () => {
    it('本地敏感词命中时入审核池，且不覆盖原昵称', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      sensitiveWord.match.mockResolvedValue('加微信');
      nicknameReviewRepository.findOne.mockResolvedValue(null);
      nicknameReviewRepository.save.mockResolvedValue({});
      userRepository.update.mockResolvedValue({});

      const result = await service.updateProfile(1, { nickname: '快来加微信吧' });

      expect(result.nicknameNotice).toContain('审核');
      expect(userRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ nickname: '原昵称', nicknameStatus: 'pending_review' }),
      );
      expect(nicknameReviewRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ checkSource: 'local', status: 'pending' }),
      );
      // 微信接口不应被调用（本地命中即省下配额）
      expect(wechat.checkText).not.toHaveBeenCalled();
    });

    it('微信判定需复核时入审核池', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      sensitiveWord.match.mockResolvedValue(null);
      wechat.checkText.mockResolvedValue({ source: 'wx', passed: false, label: 20001 });
      nicknameReviewRepository.findOne.mockResolvedValue(null);
      nicknameReviewRepository.save.mockResolvedValue({});
      userRepository.update.mockResolvedValue({});

      const result = await service.updateProfile(1, { nickname: '不良内容昵称' });

      expect(result.profile).toBeDefined();
      expect(nicknameReviewRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ checkSource: 'wx', status: 'pending' }),
      );
    });

    it('微信判定通过时昵称直接生效', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      sensitiveWord.match.mockResolvedValue(null);
      wechat.checkText.mockResolvedValue({ source: 'wx', passed: true });
      userRepository.update.mockResolvedValue({});

      const result = await service.updateProfile(1, { nickname: '小明爱学习' });

      expect(userRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ nickname: '小明爱学习', nicknameStatus: 'ok' }),
      );
      expect(result.nicknameNotice).toBeUndefined();
    });

    it('微信检测不可用时本地词表通过即放行（可用性优先）', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      sensitiveWord.match.mockResolvedValue(null);
      wechat.checkText.mockResolvedValue({ source: 'unavailable', reason: 'wx_api_error' });
      userRepository.update.mockResolvedValue({});

      await service.updateProfile(1, { nickname: '小明爱学习' });

      expect(userRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ nickname: '小明爱学习', nicknameStatus: 'ok' }),
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('重复提交同一违规昵称不重复入池（防刷审核池）', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      sensitiveWord.match.mockResolvedValue('加微信');
      nicknameReviewRepository.findOne.mockResolvedValue({ id: 5 });
      userRepository.update.mockResolvedValue({});

      await service.updateProfile(1, { nickname: '快来加微信吧' });

      expect(nicknameReviewRepository.save).not.toHaveBeenCalled();
    });

    it('昵称长度/链接不合规直接拒绝（格式问题，非内容违规）', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      await expect(service.updateProfile(1, { nickname: '短' })).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });

      await expect(
        service.updateProfile(1, { nickname: '看www.b' }),
      ).rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('隐私同意与年龄确认（隐私约束 2.4）', () => {
    it('同意隐私政策时记录时间与版本号', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      userRepository.update.mockResolvedValue({});

      const result = await service.updateProfile(1, { privacyAgreed: true });

      expect(userRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          privacyPolicyVersion: expect.any(String),
          privacyAgreedAt: expect.any(Date),
        }),
      );
      expect(result.profile).toBeDefined();
    });

    it('账号封禁时拒绝读取资料', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ status: 'disabled' }));

      await expect(service.getProfile(1)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  it('无任何更新字段时报参数错误', async () => {
    userRepository.findOne.mockResolvedValue(makeUser());

    await expect(service.updateProfile(1, {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('错误码口径：昵称非法使用 NICKNAME_INVALID', async () => {
    userRepository.findOne.mockResolvedValue(makeUser());

    const error = await service.updateProfile(1, { nickname: '短' }).catch((err) => err);

    expect((error as BusinessException).getResponse()).toMatchObject({
      code: ErrorCode.NICKNAME_INVALID,
    });
  });
});
