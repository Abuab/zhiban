import { ENV } from '../config/env';
import { ApiErrorCode } from '../constants/error-code';
import type { ApiResponse } from '../types/api';
import { authToken } from './token';

/** 网络异常（未拿到服务端响应）时的兜底错误码 */
export const NETWORK_ERROR_CODE = -1;

/** 请求失败统一异常，调用方按 code 分支处理（错误码定义见 constants/error-code.ts） */
export class ApiError extends Error {
  readonly code: number;
  readonly traceId?: string;

  constructor(code: number, message: string, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
  }

  /** 登录态失效（未登录或 token 过期） */
  get isUnauthorized(): boolean {
    return this.code === ApiErrorCode.UNAUTHORIZED || this.code === ApiErrorCode.TOKEN_EXPIRED;
  }
}

export interface RequestOptions {
  /** 业务路径，如 /health（不含 baseUrl） */
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
  /** 是否携带登录态，默认 true */
  needAuth?: boolean;
  header?: Record<string, string>;
  /** 超时时间（毫秒），默认取环境配置 */
  timeoutMs?: number;
}

/** HTTP 状态码 → 兜底文案（服务端未返回 message 时使用） */
function fallbackMessage(statusCode: number): string {
  if (statusCode === 401) return '请先登录';
  if (statusCode === 403) return '无权访问该资源';
  if (statusCode === 404) return '请求的资源不存在';
  if (statusCode === 429) return '操作过于频繁，请稍后再试';
  if (statusCode >= 500) return '服务开小差了，请稍后重试';
  return '请求失败';
}

/**
 * 统一请求封装
 * 规格依据：《基础设施与部署方案》§7 接口规范（统一响应体 + 业务错误码）
 * 成功返回 data；失败抛出 ApiError；登录态失效时自动清理本地 token
 */
export async function request<T>(options: RequestOptions): Promise<T> {
  const {
    url,
    method = 'GET',
    data,
    needAuth = true,
    header: extraHeader,
    timeoutMs = ENV.requestTimeoutMs,
  } = options;

  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeader,
  };
  if (needAuth) {
    const token = authToken.get();
    if (token) header.Authorization = `Bearer ${token}`;
  }

  let response: UniApp.RequestSuccessCallbackResult;
  try {
    response = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
      uni.request({
        url: `${ENV.apiBaseUrl}${url}`,
        method,
        data,
        header,
        timeout: timeoutMs,
        success: (res) => resolve(res),
        fail: (err) => reject(err),
      });
    });
  } catch (error) {
    const detail = error as UniApp.GeneralCallbackResult | undefined;
    throw new ApiError(NETWORK_ERROR_CODE, detail?.errMsg || '网络连接失败，请检查网络后重试');
  }

  const body = response.data as ApiResponse<T> | undefined;
  const traceId = body?.traceId;

  // 登录态失效：先清理本地 token，跳转登录页由后续登录流程统一处理
  if (response.statusCode === 401) {
    authToken.clear();
    throw new ApiError(body?.code ?? ApiErrorCode.UNAUTHORIZED, body?.message || fallbackMessage(401), traceId);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new ApiError(body?.code ?? NETWORK_ERROR_CODE, body?.message || fallbackMessage(response.statusCode), traceId);
  }

  if (!body || typeof body.code !== 'number') {
    throw new ApiError(NETWORK_ERROR_CODE, '响应格式异常，请联系客服');
  }

  if (body.code !== ApiErrorCode.SUCCESS) {
    throw new ApiError(body.code, body.message || '请求失败', traceId);
  }

  return body.data;
}

/** GET 快捷方法 */
export function get<T>(url: string, options: Omit<RequestOptions, 'url' | 'method'> = {}): Promise<T> {
  return request<T>({ ...options, url, method: 'GET' });
}

/** POST 快捷方法 */
export function post<T>(
  url: string,
  data?: Record<string, unknown>,
  options: Omit<RequestOptions, 'url' | 'method' | 'data'> = {},
): Promise<T> {
  return request<T>({ ...options, url, method: 'POST', data });
}
