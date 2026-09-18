import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import { ENV, REQUEST_TIMEOUT_MS } from '@/config/env';
import router from '@/router';
import type { ApiResponse } from '@/types/api';

/** 登录令牌在 localStorage 中的键名 */
export const ADMIN_TOKEN_KEY = 'admin_token';

/** 二次验证绑定标记（仅作本地提示，真实状态以服务端 profile 为准） */
export const ADMIN_TOTP_MARKER_KEY = 'admin_totp_bound';

/** 未拿到服务端响应（网络异常 / 响应体结构异常）时的兜底错误码 */
export const NETWORK_ERROR_CODE = -1;

/** 业务错误码（与服务端 common/constants/error-code.ts 对齐） */
export const ApiErrorCode = {
  SUCCESS: 0,
  PARAM_INVALID: 10001,
  UNAUTHORIZED: 20001,
  TOKEN_EXPIRED: 20002,
  ACCOUNT_DISABLED: 20008,
  SESSION_INVALID: 20009,
  ADMIN_CREDENTIAL_INVALID: 20010,
  ADMIN_TOTP_REQUIRED: 20011,
  ADMIN_TOTP_INVALID: 20012,
  ADMIN_TOTP_NOT_SETUP: 20013,
  ADMIN_TOTP_ALREADY_ENABLED: 20014,
  RATE_LIMITED: 70001,
  IP_FORBIDDEN: 70002,
} as const;

/** 请求失败统一异常，调用方按 code 分支处理 */
export class ApiError extends Error {
  readonly code: number;
  readonly traceId?: string;
  /** 拦截器是否已做全局提示或跳转（true 时调用方无需重复提示） */
  readonly handled: boolean;

  constructor(code: number, message: string, traceId?: string, handled = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
    this.handled = handled;
  }
}

/** 读取本地登录令牌 */
export function getToken(): string {
  return localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
}

/** 写入本地登录令牌 */
export function setToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

/** 清除本地登录令牌与二次验证标记 */
export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOTP_MARKER_KEY);
}

/** 标记已完成二次验证绑定 */
export function markTotpBound(): void {
  localStorage.setItem(ADMIN_TOTP_MARKER_KEY, '1');
}

/** 展示错误提示；拦截器已提示或已跳转的错误不再重复提示 */
export function showError(error: unknown): void {
  if (error instanceof ApiError) {
    if (error.handled) return;
    ElMessage.error(error.message);
    return;
  }
  ElMessage.error('请求失败，请稍后重试');
}

/** HTTP 状态码兜底文案（服务端未返回 message 时使用） */
function fallbackMessage(status: number): string {
  if (status === 400) return '请求参数不合法';
  if (status === 401) return '请先登录';
  if (status === 403) return '无权访问该资源';
  if (status === 404) return '请求的资源不存在';
  if (status === 409) return '数据状态冲突，请刷新后重试';
  if (status === 429) return '操作过于频繁，请稍后再试';
  if (status >= 500) return '服务开小差了，请稍后重试';
  return '请求失败';
}

/** 回到登录页（已在登录页时不重复跳转） */
function redirectToLogin(): void {
  if (router.currentRoute.value.path === '/login') return;
  void router.replace({ path: '/login' });
}

/** 跳转二次验证绑定页 */
function redirectToTotpBind(): void {
  if (router.currentRoute.value.path === '/totp-bind') return;
  void router.replace({ path: '/totp-bind' });
}

/**
 * 业务错误码统一处理（跳转 / 全局提示）
 * 返回 true 表示已全局处理，调用方无需再提示
 */
function handleBusinessError(code: number, message: string): boolean {
  switch (code) {
    // 未登录 / 令牌无效 / 令牌过期 / 会话已被撤销：清 token 回登录页
    case ApiErrorCode.UNAUTHORIZED:
    case ApiErrorCode.TOKEN_EXPIRED:
    case ApiErrorCode.SESSION_INVALID:
      clearToken();
      redirectToLogin();
      return true;

    // 账号已停用：提示后清 token 回登录页
    case ApiErrorCode.ACCOUNT_DISABLED:
      clearToken();
      ElMessage.error(message || '账号已被停用');
      redirectToLogin();
      return true;

    // 必须先完成二次验证绑定
    case ApiErrorCode.ADMIN_TOTP_REQUIRED:
      localStorage.removeItem(ADMIN_TOTP_MARKER_KEY);
      ElMessage.warning(message || '请先完成二次验证绑定');
      redirectToTotpBind();
      return true;

    // 限流与网络环境限制：仅全局提示，原地重试即可
    case ApiErrorCode.RATE_LIMITED:
    case ApiErrorCode.IP_FORBIDDEN:
      ElMessage.error(message || '请求被拒绝');
      return true;

    // 其余错误码（如账号密码错误、二次验证码错误、参数不合法）由调用方就近展示，避免重复提示
    default:
      return false;
  }
}

const http: AxiosInstance = axios.create({
  baseURL: ENV.apiBaseUrl,
  timeout: REQUEST_TIMEOUT_MS,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown> | undefined;

    if (!body || typeof body.code !== 'number') {
      throw new ApiError(NETWORK_ERROR_CODE, '响应格式异常，请稍后重试', undefined, true);
    }

    // 以响应体中的 code 为准，而不是 HTTP 状态码
    if (body.code !== ApiErrorCode.SUCCESS) {
      const handled = handleBusinessError(body.code, body.message);
      throw new ApiError(body.code, body.message || '请求失败', body.traceId, handled);
    }

    // 解包：调用方直接拿到业务数据
    return body.data as never;
  },
  (error: unknown) => {
    if (error instanceof ApiError) return Promise.reject(error);

    if (!axios.isAxiosError(error) || !error.response) {
      const message = '网络异常，请稍后重试';
      ElMessage.error(message);
      return Promise.reject(new ApiError(NETWORK_ERROR_CODE, message, undefined, true));
    }

    const body = error.response.data as ApiResponse<unknown> | undefined;
    const code = typeof body?.code === 'number' ? body.code : NETWORK_ERROR_CODE;
    const message = body?.message || fallbackMessage(error.response.status);
    const handled = handleBusinessError(code, message);

    return Promise.reject(new ApiError(code, message, body?.traceId, handled));
  },
);

/** 统一请求入口：返回已解包的业务数据（响应拦截器已把统一响应体解包成 data） */
export function request<T>(config: AxiosRequestConfig): Promise<T> {
  return http.request(config) as unknown as Promise<T>;
}

/** GET 快捷方法 */
export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'GET', params });
}

/** POST 快捷方法 */
export function post<T>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'POST', data });
}

/** PATCH 快捷方法 */
export function patch<T>(url: string, data: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'PATCH', data });
}

export default http;
