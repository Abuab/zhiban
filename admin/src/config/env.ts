/**
 * 运行环境配置的统一出口
 * 约束：接口地址与品牌名禁止硬编码，一律从环境变量读取
 *      （构建期缺失即失败，避免打出连不上后端的包 / 品牌名写死在代码里）
 */

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const brandName = import.meta.env.VITE_BRAND_NAME;
const adminName = import.meta.env.VITE_ADMIN_NAME;

if (!apiBaseUrl) {
  throw new Error('缺少环境变量 VITE_API_BASE_URL，请在 .env 中配置接口前缀');
}
if (!brandName) {
  throw new Error('缺少环境变量 VITE_BRAND_NAME，请在 .env 中配置品牌名兜底值');
}
if (!adminName) {
  throw new Error('缺少环境变量 VITE_ADMIN_NAME，请在 .env 中配置后台称谓');
}

export const ENV = {
  /** 接口前缀，例如 /api（与后端全局前缀对齐，生产由宿主 Nginx 同域反代） */
  apiBaseUrl,
  /** 本地开发时 Vite 代理的后端地址；为空表示不使用代理（仅构建配置消费） */
  devProxyTarget: import.meta.env.VITE_DEV_PROXY_TARGET ?? '',
  /**
   * 品牌名兜底值：仅用于「接口下发前 / 下发失败」时的降级展示。
   * 运行时真源是服务端 sys_config.brand.name（宪法 P5），代码中不得出现品牌名字面量。
   */
  brandName,
  /** 后台自身称谓，与品牌名组成浏览器标题（如「知伴 管理后台」） */
  adminName,
} as const;

/** 请求超时时间（毫秒） */
export const REQUEST_TIMEOUT_MS = 15000;
