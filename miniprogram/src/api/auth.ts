import { API_VERSION_PREFIX } from '../config/env';
import type { LoginResult, UpdateProfileInput, UpdateProfileResult, UserProfile } from '../types/api';
import { get, post, put } from '../utils/request';

/** 登录相关接口基路径（模块 2 的 5 个接口，契约见 docs/api.md） */
const BASE = `${API_VERSION_PREFIX}/auth`;

/**
 * 账号与登录接口
 * 说明：login 是唯一不需要登录态的接口（needAuth: false），
 *      其余接口由服务端 AuthGuard 校验 JWT + Redis 会话
 */
export const authApi = {
  /** 微信登录：code 换 openid 并签发登录态 */
  login(code: string): Promise<LoginResult> {
    return post<LoginResult, { code: string }>(`${BASE}/login`, { code }, { needAuth: false });
  },

  /** 登录态续期（沿用当前会话） */
  refresh(): Promise<LoginResult> {
    return post<LoginResult>(`${BASE}/refresh`);
  },

  /** 退出登录（仅撤销当前设备会话，其他设备不受影响） */
  logout(): Promise<{ revoked: boolean }> {
    return post<{ revoked: boolean }>(`${BASE}/logout`);
  },

  /** 查询本人资料 */
  getProfile(): Promise<UserProfile> {
    return get<UserProfile>(`${BASE}/profile`);
  },

  /** 更新资料（昵称 / 头像 / 隐私同意 / 年龄确认） */
  updateProfile(payload: UpdateProfileInput): Promise<UpdateProfileResult> {
    return put<UpdateProfileResult, UpdateProfileInput>(`${BASE}/profile`, payload);
  },
};
