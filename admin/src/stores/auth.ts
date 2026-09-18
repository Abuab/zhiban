import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as authApi from '@/api/auth';
import { clearToken, getToken, markTotpBound, setToken } from '@/api/http';
import type { AdminLoginInput, AdminLoginResult, AdminProfile } from '@/types/api';

export const useAuthStore = defineStore('auth', () => {
  /** 登录令牌（与 localStorage 同步，刷新页面后保持登录态） */
  const token = ref<string>(getToken());
  /** 当前管理员资料；null 表示尚未拉取 */
  const profile = ref<AdminProfile | null>(null);

  /** 是否已完成二次验证绑定 */
  const isTotpBound = computed(() => profile.value?.totpEnabled === true);

  /** 登录并落地令牌与资料 */
  async function login(input: AdminLoginInput): Promise<AdminLoginResult> {
    const result = await authApi.login(input);
    setToken(result.token);
    token.value = result.token;
    // 登录返回体不含 lastLoginAt，先置空，进入后台后由 fetchProfile 补全
    profile.value = { ...result.admin, lastLoginAt: null };
    if (result.admin.totpEnabled) markTotpBound();
    return result;
  }

  /** 拉取当前管理员资料 */
  async function fetchProfile(): Promise<AdminProfile> {
    const result = await authApi.fetchProfile();
    profile.value = result;
    if (result.totpEnabled) markTotpBound();
    return result;
  }

  /** 退出登录：先通知服务端撤销会话，无论成败都清空本地登录态 */
  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // 会话可能已失效，忽略错误，本地照常清理
    } finally {
      clear();
    }
  }

  /** 清空本地登录态 */
  function clear(): void {
    clearToken();
    token.value = '';
    profile.value = null;
  }

  return { token, profile, isTotpBound, login, fetchProfile, logout, clear };
});
