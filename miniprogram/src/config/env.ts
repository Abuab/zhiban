/**
 * 环境配置统一出口
 * 约定：业务代码禁止直接读 import.meta.env（与「配置化落地」原则一致，见宪法 P5）
 */

/** 运行环境标识 */
export type AppEnv = 'development' | 'production';

function readAppEnv(): AppEnv {
  const value = import.meta.env.VITE_APP_ENV;
  return value === 'production' ? 'production' : 'development';
}

function readApiBaseUrl(): string {
  // 去掉结尾斜杠，保证与业务路径拼接后不会出现双斜杠
  const raw = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    // 构建期即抛错：避免打出一个「接口地址为空」的包才发现
    throw new Error('缺少环境变量 VITE_API_BASE_URL，请检查 .env.development / .env.production');
  }
  return raw;
}

export const ENV = {
  appEnv: readAppEnv(),
  apiBaseUrl: readApiBaseUrl(),
  /** 请求超时（毫秒） */
  requestTimeoutMs: 15000,
} as const;

export const IS_DEV = ENV.appEnv === 'development';
