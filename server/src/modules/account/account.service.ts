import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../../common/constants/privacy.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { isDuplicateKeyError } from '../../common/utils/db-error.util.js';
import { SensitiveWordService } from '../content/sensitive-word.service.js';
import { WechatService } from '../wechat/wechat.service.js';
import type { UpdateProfileResult, UserProfile } from './account.types.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { NicknameReviewEntity } from './entities/nickname-review.entity.js';
import { UserEntity, type NicknameStatus } from './entities/user.entity.js';

/** 昵称长度限制（按 Unicode 码点计数，emoji 记 1） */
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 20;
/** 控制字符与换行：昵称展示场景一律不允许（防注入与排版破坏） */
const NICKNAME_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** 链接特征：昵称禁止承载导流链接 */
const NICKNAME_LINK_PATTERN = /(https?:\/\/|www\.)/i;

/** 入池提示文案（不含违规词，可直接展示；体现「不直接拒绝」的 A6 处理原则） */
const NICKNAME_PENDING_NOTICE = '昵称已提交审核，审核通过后自动生效，期间仍展示原昵称';

/** 按 Unicode 码点计数（避免 emoji 被算成 2 个字符） */
const countChars = (text: string): number => Array.from(text).length;

/**
 * 账号服务（模块 2）
 * 规格依据：
 *   - 边界总表 A1（openid 唯一、建档幂等）/ A2（不迁移，仅提示）/ A6（昵称内容安全）
 *   - 隐私约束 2.4（年龄确认、隐私政策同意、字段最小化）
 */
@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(NicknameReviewEntity)
    private readonly nicknameReviewRepository: Repository<NicknameReviewEntity>,
    private readonly wechat: WechatService,
    private readonly sensitiveWord: SensitiveWordService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 按 openid 幂等建档（A1：openid 不变 → 换手机/重装微信后自动跟随同一账号）
   * 并发首登由 uk_openid 唯一键兜底，捕获 ER_DUP_ENTRY 后回读，保证「登录多次仍只有一个账号」
   */
  async ensureUserByOpenid(input: {
    openid: string;
    unionid?: string;
  }): Promise<{ user: UserEntity; isNew: boolean }> {
    const existing = await this.userRepository.findOne({ where: { openid: input.openid } });
    if (existing) {
      // unionid 可能后到（如后续绑定开放平台），补齐即可，绝不新建账号
      if (input.unionid && existing.unionid !== input.unionid) {
        await this.userRepository.update(existing.id, { unionid: input.unionid });
        existing.unionid = input.unionid;
      }
      return { user: existing, isNew: false };
    }

    try {
      const created = await this.userRepository.save(
        this.userRepository.create({
          openid: input.openid,
          unionid: input.unionid ?? null,
          nickname: null,
          avatarUrl: null,
        }),
      );
      return { user: created, isNew: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const again = await this.userRepository.findOne({ where: { openid: input.openid } });
      if (!again) throw error;
      return { user: again, isNew: false };
    }
  }

  /** 账号可用性校验：封禁/注销中禁止登录（A2 与 F 域） */
  assertAccountUsable(user: UserEntity): void {
    if (user.status === 'disabled') {
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED);
    }
    if (user.status === 'deleting') {
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED, '账号注销处理中，无法继续使用');
    }
  }

  async getProfile(userId: number): Promise<UserProfile> {
    const user = await this.requireUsableUser(userId);
    return this.toProfile(user);
  }

  /**
   * 批量取昵称（跨域展示用：邀请详情 / 报告页要展示「对方昵称」）
   *
   * 刻意**不复用** `requireUsableUser`：对方账号被封禁/注销不应让本人的邀请详情与历史报告打不开
   * （历史报告永久可回看，PRD-002 §5）；此处只做只读展示，不承担可用性判定。
   */
  async findNicknames(userIds: number[]): Promise<Map<number, string | null>> {
    const unique = [...new Set(userIds)].filter((id) => Number.isFinite(id));
    if (unique.length === 0) return new Map();

    const users = await this.userRepository.find({
      where: { id: In(unique) },
      select: { id: true, nickname: true },
    });
    return new Map(users.map((user) => [Number(user.id), user.nickname]));
  }

  /**
   * 取订阅消息投递目标（提醒 TA 用）
   * 与 findNicknames 同理：只读，不做可用性判定；用户不存在返回 null（由调用方按业务错误处理）
   */
  async findNotifyTarget(
    userId: number,
  ): Promise<{ openid: string; nickname: string | null } | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, openid: true, nickname: true },
    });
    if (!user) return null;
    return { openid: user.openid, nickname: user.nickname };
  }

  /** 取账号并校验可用性（登录/续期/读写资料前统一调用） */
  async requireUsableUser(userId: number): Promise<UserEntity> {
    const user = await this.findUserOrFail(userId);
    this.assertAccountUsable(user);
    return user;
  }

  /**
   * 更新资料：昵称（内容安全） / 头像 / 隐私同意 / 年龄确认
   * 注意：单次只允许提交需要变更的字段；全部缺省直接报参数错误，避免无意义写库
   */
  async updateProfile(userId: number, dto: UpdateProfileDto): Promise<UpdateProfileResult> {
    const user = await this.requireUsableUser(userId);

    const patch: Partial<UserEntity> = {};
    let nicknameNotice: string | undefined;

    if (dto.nickname !== undefined) {
      const resolved = await this.resolveNickname(user, dto.nickname);
      patch.nickname = resolved.nickname;
      patch.nicknameStatus = resolved.nicknameStatus;
      nicknameNotice = resolved.notice;
    }

    if (dto.avatarUrl !== undefined) {
      patch.avatarUrl = dto.avatarUrl;
    }

    if (dto.privacyAgreed === true) {
      patch.privacyAgreedAt = user.privacyAgreedAt ?? new Date();
      patch.privacyPolicyVersion = dto.privacyPolicyVersion ?? CURRENT_PRIVACY_POLICY_VERSION;
    }

    if (dto.ageConfirmed === true) {
      patch.ageConfirmed = 1;
    }

    if (Object.keys(patch).length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有需要更新的字段');
    }

    await this.userRepository.update(userId, patch);
    const updated = await this.findUserOrFail(userId);
    return { profile: this.toProfile(updated), nicknameNotice };
  }

  /**
   * 昵称解析（A6 核心逻辑）
   * 顺序：格式校验 → 本地敏感词兜底（省微信配额）→ 微信内容安全 → 违规入审核池（不直接拒绝）
   * 降级策略：微信检测不可用时，本地词表已通过即放行（可用性优先，与限流守卫降级一致），并留告警
   */
  private async resolveNickname(
    user: UserEntity,
    raw: string,
  ): Promise<{ nickname: string | null; nicknameStatus: NicknameStatus; notice?: string }> {
    const nickname = raw.trim();
    this.assertNicknameFormat(nickname);

    const hitWord = await this.sensitiveWord.match(nickname, 'nickname');
    if (hitWord) {
      await this.enqueueNicknameReview(user.id, nickname, 'local', { matchedWord: hitWord });
      return { nickname: user.nickname, nicknameStatus: 'pending_review', notice: NICKNAME_PENDING_NOTICE };
    }

    const check = await this.wechat.checkText(nickname, user.openid);
    if (check.source === 'wx') {
      if (check.passed) {
        return { nickname, nicknameStatus: 'ok' };
      }
      await this.enqueueNicknameReview(user.id, nickname, 'wx', {
        suggest: 'review_or_risky',
        label: check.label,
      });
      this.logger.warn(`昵称被微信内容安全判定为需复核：userId=${user.id}`, 'AccountService');
      return { nickname: user.nickname, nicknameStatus: 'pending_review', notice: NICKNAME_PENDING_NOTICE };
    }

    this.logger.warn(
      `微信内容安全不可用（${check.reason}），昵称仅经本地词表兜底后放行：userId=${user.id}`,
      'AccountService',
    );
    return { nickname, nicknameStatus: 'ok' };
  }

  /**
   * 昵称入审核池
   * 防滥用：同一用户重复提交同一昵称时复用待审记录，避免恶意刷池（昵称接口另有限流）
   */
  private async enqueueNicknameReview(
    userId: number,
    nickname: string,
    source: 'wx' | 'local',
    detail: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.nicknameReviewRepository.findOne({
      where: { userId, nickname, status: 'pending' },
    });
    if (existing) return;

    await this.nicknameReviewRepository.save(
      this.nicknameReviewRepository.create({
        userId,
        nickname,
        checkSource: source,
        checkResult: detail,
        status: 'pending',
      }),
    );
  }

  /** 昵称格式校验：长度、控制字符、链接（违规词判定不在此处，见 resolveNickname） */
  private assertNicknameFormat(nickname: string): void {
    const length = countChars(nickname);
    if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
      throw new BusinessException(
        ErrorCode.NICKNAME_INVALID,
        `昵称长度需为 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`,
      );
    }
    if (NICKNAME_CONTROL_CHARS.test(nickname)) {
      throw new BusinessException(ErrorCode.NICKNAME_INVALID, '昵称不能包含换行或特殊控制字符');
    }
    if (NICKNAME_LINK_PATTERN.test(nickname)) {
      throw new BusinessException(ErrorCode.NICKNAME_INVALID, '昵称不能包含网址');
    }
  }

  private async findUserOrFail(userId: number): Promise<UserEntity> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      // 会话有效但用户不存在（极端情况：账号已被物理删除）→ 视为登录态失效
      throw new BusinessException(ErrorCode.SESSION_INVALID);
    }
    return user;
  }

  /** 实体 → 对外资料结构（登录与资料接口共用，保证两处返回一致） */
  toProfile(user: UserEntity): UserProfile {
    return {
      id: Number(user.id),
      nickname: user.nickname,
      nicknameStatus: user.nicknameStatus,
      avatarUrl: user.avatarUrl,
      ageConfirmed: user.ageConfirmed === 1,
      privacyAgreed: user.privacyAgreedAt !== null,
      privacyPolicyVersion: user.privacyPolicyVersion,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
