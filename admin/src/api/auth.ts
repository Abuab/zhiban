import { get, post } from './http';
import type {
  AdminLoginInput,
  AdminLoginResult,
  AdminProfile,
  TotpSetupResult,
} from '@/types/api';

/** 后台登录（口令 + 动态码） */
export function login(data: AdminLoginInput): Promise<AdminLoginResult> {
  return post<AdminLoginResult>('/admin/auth/login', { ...data });
}

/** 当前管理员资料（未绑定二次验证时也可访问，用于判断是否跳绑定页） */
export function fetchProfile(): Promise<AdminProfile> {
  return get<AdminProfile>('/admin/auth/profile');
}

/** 退出登录（仅撤销当前设备会话） */
export function logout(): Promise<{ revoked: boolean }> {
  return post<{ revoked: boolean }>('/admin/auth/logout');
}

/** 生成二次验证密钥（返回 otpauth URI 供前端渲染二维码，此时尚未落库） */
export function setupTotp(): Promise<TotpSetupResult> {
  return post<TotpSetupResult>('/admin/auth/totp/setup');
}

/** 提交一次动态码完成二次验证绑定 */
export function enableTotp(code: string): Promise<{ totpEnabled: true }> {
  return post<{ totpEnabled: true }>('/admin/auth/totp/enable', { code });
}
