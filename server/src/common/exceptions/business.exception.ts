import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorMessage } from '../constants/error-code.js';

/**
 * 业务异常：统一携带业务错误码
 * 用法：throw new BusinessException(ErrorCode.INVITE_EXPIRED)
 * 状态码默认取 ErrorStatus 映射（鉴权 401 / 越权 403 / 限流 429），未映射的按 400
 */
export class BusinessException extends HttpException {
  constructor(code: ErrorCode, message?: string, status?: HttpStatus) {
    super(
      { code, message: message ?? ErrorMessage[code] },
      status ?? ErrorStatus[code] ?? HttpStatus.BAD_REQUEST,
    );
  }
}

/** 常用业务错误码 → HTTP 状态码映射（供守卫与拦截器复用） */
export const ErrorStatus: Record<number, HttpStatus> = {
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.SESSION_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.ADMIN_CREDENTIAL_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.ADMIN_TOTP_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.ADMIN_TOTP_REQUIRED]: HttpStatus.FORBIDDEN,
  [ErrorCode.ADMIN_TOTP_ALREADY_ENABLED]: HttpStatus.CONFLICT,
  [ErrorCode.AGE_NOT_CONFIRMED]: HttpStatus.FORBIDDEN,
  [ErrorCode.PRIVACY_NOT_AGREED]: HttpStatus.FORBIDDEN,
  [ErrorCode.ACCOUNT_DISABLED]: HttpStatus.FORBIDDEN,
  [ErrorCode.REPORT_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.ANSWER_DRAFT_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.RESOURCE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.SCALE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.INVITE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.TOPIC_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
};
