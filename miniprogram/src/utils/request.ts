import { ENV } from '../config/env';
import { ApiErrorCode, ClientErrorCode } from '../constants/error-code';
import type { ApiResponse } from '../types/api';
import { authToken } from './token';

/** 网络异常（未拿到服务端响应）时的兜底错误码 */
export const NETWORK_ERROR_CODE = ClientErrorCode.NETWORK_ERROR;

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

  /** 登录态失效（未登录 / token 过期 / 会话已被撤销） */
  get isUnauthorized(): boolean {
    return (
      this.code === ApiErrorCode.UNAUTHORIZED ||
      this.code === ApiErrorCode.TOKEN_EXPIRED ||
      this.code === ApiErrorCode.SESSION_INVALID
    );
  }
}

export interface RequestOptions<TBody = Record<string, unknown>> {
  /** 业务路径，如 /v1/auth/login（不含 baseUrl） */
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: TBody;
  /** 是否携带登录态，默认 true */
  needAuth?: boolean;
  header?: Record<string, string>;
  /** 超时时间（毫秒），默认取环境配置 */
  timeoutMs?: number;
}

/**
 * 登录态失效处理器：返回 true 表示已重新拿到登录态，可重放原请求
 * 由 utils/auth.ts 注册（避免 request 反向依赖 auth 造成循环引用）
 * 作用：实现 A1「token 失效后静默重新登录，用户无感」——用户不会看到登录页或报错
 */
type UnauthorizedHandler = () => Promise<boolean>;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
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
 * 行为：
 *   1. 成功返回 data；失败抛出 ApiError
 *   2. 401 → 先尝试静默重登并重放一次（A1）；重登失败才向上抛错（由调用方引导登录，A4）
 *   3. 网络异常 → 抛出可重试的 ApiError（A5 不出现死页）
 */
export async function request<T, TBody = Record<string, unknown>>(
  options: RequestOptions<TBody>,
): Promise<T> {
  return send<T, TBody>(options, false);
}

async function send<T, TBody>(options: RequestOptions<TBody>, retried: boolean): Promise<T> {
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
        data: data as UniApp.RequestOptions['data'],
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

  if (response.statusCode === 401) {
    authToken.clear();
    const code = body?.code ?? ApiErrorCode.UNAUTHORIZED;

    // A1：token 失效后静默重登并重放原请求（仅重试一次，避免死循环）
    if (!retried && needAuth && unauthorizedHandler) {
      const recovered = await unauthorizedHandler();
      if (recovered) return send<T, TBody>(options, true);
    }

    throw new ApiError(code, body?.message || fallbackMessage(401), traceId);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new ApiError(
      body?.code ?? NETWORK_ERROR_CODE,
      body?.message || fallbackMessage(response.statusCode),
      traceId,
    );
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
export function get<T>(
  url: string,
  options: Omit<RequestOptions<Record<string, unknown>>, 'url' | 'method'> = {},
): Promise<T> {
  return request<T>({ ...options, url, method: 'GET' });
}

/** POST 快捷方法 */
export function post<T, TBody = Record<string, unknown>>(
  url: string,
  data?: TBody,
  options: Omit<RequestOptions<TBody>, 'url' | 'method' | 'data'> = {},
): Promise<T> {
  return request<T, TBody>({ ...options, url, method: 'POST', data });
}

/** PUT 快捷方法 */
export function put<T, TBody = Record<string, unknown>>(
  url: string,
  data?: TBody,
  options: Omit<RequestOptions<TBody>, 'url' | 'method' | 'data'> = {},
): Promise<T> {
  return request<T, TBody>({ ...options, url, method: 'PUT', data });
}
