import { ref } from 'vue';
import type { UserProfile } from '../types/api';

/**
 * 登录态与用户资料（内存态）
 * 设计：资料只放内存，不落本地存储（P3 隐私即卖点：本地不留敏感数据）；
 *      页面刷新/重启后通过静默登录重新拉取
 */
export const isLoggedIn = ref(false);
export const userProfile = ref<UserProfile | null>(null);

/** 登录成功后写入 */
export function setLoginState(profile: UserProfile): void {
  userProfile.value = profile;
  isLoggedIn.value = true;
}

/** 资料更新后刷新 */
export function setUserProfile(profile: UserProfile): void {
  userProfile.value = profile;
}

/** 退出登录 / 登录态失效时清空 */
export function clearLoginState(): void {
  userProfile.value = null;
  isLoggedIn.value = false;
}
