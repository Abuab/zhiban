import type { NicknameStatus } from './entities/user.entity.js';

/**
 * 用户资料（对外返回结构）
 * 注意：不返回 openid / unionid / status —— 接口最小化暴露，
 *      小程序端无需账号标识（会话由 token 承载），减少敏感信息流转面（隐私约束 2.4）
 */
export interface UserProfile {
  id: number;
  nickname: string | null;
  /** 昵称状态：pending_review 时前端需提示「昵称审核中，暂未生效」 */
  nicknameStatus: NicknameStatus;
  avatarUrl: string | null;
  /** 是否已确认年满 18（未确认则不可使用，隐私约束 2.4） */
  ageConfirmed: boolean;
  /** 是否已同意隐私政策（不同意仅可浏览首页，隐私约束 2.4） */
  privacyAgreed: boolean;
  privacyPolicyVersion: string | null;
  createdAt: string;
}

/** 资料更新结果 */
export interface UpdateProfileResult {
  profile: UserProfile;
  /** 昵称相关提示文案（命中审核池时返回，已剔除违规词，可直接展示） */
  nicknameNotice?: string;
}
