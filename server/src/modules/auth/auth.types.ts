import type { UserProfile } from '../account/account.types.js';

/** JWT 载荷：sub=user.id，sid=会话 id（用于多设备独立会话与按设备撤销） */
export interface JwtPayload {
  sub: number;
  openid: string;
  sid: string;
}

/** 登录/续期返回结构 */
export interface LoginResult {
  token: string;
  tokenType: 'Bearer';
  /** token 有效期（秒） */
  expiresIn: number;
  /** 是否本次新建账号（前端可据此决定是否引导完善资料） */
  isNewUser: boolean;
  user: UserProfile;
}
