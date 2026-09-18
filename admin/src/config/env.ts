/**
 * 运行环境配置的统一出口
 * 约束：接口地址禁止硬编码，一律从环境变量读取（构建期缺失即失败，避免打出连不上后端的包）
 */

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error('缺少环境变量 VITE_API_BASE_URL，请在 .env 中配置接口前缀');
}

export const ENV = {
  /** 接口前缀，例如 /api（与后端全局前缀对齐，生产由宿主 Nginx 同域反代） */
  apiBaseUrl,
  /** 本地开发时 Vite 代理的后端地址；为空表示不使用代理（仅构建配置消费） */
  devProxyTarget: import.meta.env.VITE_DEV_PROXY_TARGET ?? '',
} as const;

/** 请求超时时间（毫秒） */
export const REQUEST_TIMEOUT_MS = 15000;
