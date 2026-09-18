/**
 * 接口层通用类型
 * 与服务端对应文件保持一致（改动需同步两端）：
 *   - server/src/common/dto/api-response.dto.ts
 *   - server/src/modules/account/account.types.ts
 *   - server/src/modules/auth/auth.types.ts
 */

/** 统一响应体 */
export interface ApiResponse<T> {
  /** 业务错误码，0 = 成功 */
  code: number;
  message: string;
  data: T;
  /** 链路 ID，报障时提供给客服便于定位 */
  traceId?: string;
  timestamp: number;
}

/** 昵称状态：pending_review 时需提示「审核中，暂未生效」 */
export type NicknameStatus = 'ok' | 'pending_review' | 'rejected';

/** 用户资料（不含 openid 等账号标识，接口最小化暴露） */
export interface UserProfile {
  id: number;
  nickname: string | null;
  nicknameStatus: NicknameStatus;
  avatarUrl: string | null;
  /** 是否已确认年满 18 */
  ageConfirmed: boolean;
  /** 是否已同意隐私政策 */
  privacyAgreed: boolean;
  privacyPolicyVersion: string | null;
  createdAt: string;
}

/** 登录 / 续期返回 */
export interface LoginResult {
  token: string;
  tokenType: 'Bearer';
  /** token 有效期（秒） */
  expiresIn: number;
  isNewUser: boolean;
  user: UserProfile;
}

/** 资料更新入参（未传字段不变更） */
export interface UpdateProfileInput {
  nickname?: string;
  avatarUrl?: string;
  privacyAgreed?: boolean;
  privacyPolicyVersion?: string;
  ageConfirmed?: boolean;
}

/** 资料更新返回 */
export interface UpdateProfileResult {
  profile: UserProfile;
  /** 昵称提示文案（命中审核池时返回） */
  nicknameNotice?: string;
}

/**
 * 站点公开配置（GET /v1/config/public，ADR-002）
 * 与库中 sys_config 的点分键一致：brand.name → brand.name
 * 免鉴权接口，登录前即可获取；字段缺失时前端必须用兜底值（ADR-002 决策 4）
 */
export interface PublicConfig {
  /** 品牌展示配置（对应库中 brand.* 键） */
  brand?: {
    /** 品牌名：登录页主标题、授权弹窗、隐私政策页标题、首页导航栏标题 */
    name?: string;
  };
}
