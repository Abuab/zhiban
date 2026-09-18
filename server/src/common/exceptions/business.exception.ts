import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorMessage } from '../constants/error-code.js';

/**
 * 业务异常：统一携带业务错误码
 * 用法：throw new BusinessException(ErrorCode.INVITE_EXPIRED)
 * 状态码默认 400；鉴权用 401、越权用 403、限流用 429（见 ErrorStatus）
 */
export class BusinessException extends HttpException {
  constructor(code: ErrorCode, message?: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ code, message: message ?? ErrorMessage[code] }, status);
  }
}

/** 常用业务错误码 → HTTP 状态码映射（供守卫与拦截器复用） */
export const ErrorStatus: Record<number, HttpStatus> = {
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AGE_NOT_CONFIRMED]: HttpStatus.FORBIDDEN,
  [ErrorCode.PRIVACY_NOT_AGREED]: HttpStatus.FORBIDDEN,
  [ErrorCode.REPORT_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.RESOURCE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.SCALE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.INVITE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.TOPIC_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
};
