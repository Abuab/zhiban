/**
 * 客户端需分支处理的错误码子集
 * 完整错误码定义见服务端 server/src/common/constants/error-code.ts（新增需两端同步）
 */
export const ApiErrorCode = {
  SUCCESS: 0,
  PARAM_INVALID: 10001,
  /** 未登录 */
  UNAUTHORIZED: 20001,
  /** 登录已过期 */
  TOKEN_EXPIRED: 20002,
  /** 触发限流 */
  RATE_LIMITED: 70001,
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
