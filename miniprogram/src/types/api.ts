/**
 * 接口层通用类型
 * 与服务端 server/src/common/dto/api-response.dto.ts 保持一致（改动需同步两端）
 */

/** 统一响应体 */
export interface ApiResponse<T> {
  /** 业务错误码，0 = 成功 */
  code: number;
  message: string;
  data: T;
  /** 链路 ID，报障时提供给客服便于定位 */
  traceId?: string;
  timestamp: number;
}
