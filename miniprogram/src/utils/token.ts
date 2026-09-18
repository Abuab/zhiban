/**
 * 登录态本地存储
 * 仅存 token 本身；用户资料不入本地缓存（P3 隐私即卖点：本地不留敏感数据）
 */
const TOKEN_KEY = 'zhiban:token';

export const authToken = {
  get(): string {
    return uni.getStorageSync(TOKEN_KEY) || '';
  },
  set(token: string): void {
    uni.setStorageSync(TOKEN_KEY, token);
  },
  clear(): void {
    uni.removeStorageSync(TOKEN_KEY);
  },
};
