/** 统一响应体：所有小程序接口与后台接口共用 */
export interface ApiResponse<T> {
  /** 业务错误码，0 = 成功 */
  code: number;
  message: string;
  data: T;
  /** 链路 ID，便于排查与客服定位 */
  traceId?: string;
  timestamp: number;
}
