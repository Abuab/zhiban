import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode, ErrorMessage } from '../constants/error-code.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { AppLogger } from '../logger/app-logger.service.js';
import type { AppRequest } from '../types/request-context.js';

/** HTTP 状态码 → 业务错误码兜底映射 */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.PARAM_INVALID,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

/**
 * 全局异常处理：统一 { code, message, data, traceId, timestamp }
 * 5xx 记录完整堆栈；4xx 只记录一行摘要（避免日志噪音）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly rawLogger = new Logger('Exception');

  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AppRequest>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    let message: string = ErrorMessage[ErrorCode.INTERNAL_ERROR];

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { code: ErrorCode; message: string };
      code = body.code;
      message = body.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.code === 'number') code = record.code as ErrorCode;
        if (Array.isArray(record.message)) message = record.message.join('；');
        else if (record.message) message = String(record.message);
      }
      if (code === ErrorCode.INTERNAL_ERROR && status < 500) {
        message = message || ErrorMessage[ErrorCode.PARAM_INVALID];
      }
    } else {
      // 非预期异常：仅在服务端留痕，对外统一脱敏文案
      const detail = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `未捕获异常 ${request?.method} ${request?.path}：${detail.message}`,
        detail.stack,
        'Exception',
      );
      this.rawLogger.error(detail.message, detail.stack);
    }

    if (status >= 500) {
      this.logger.writeWithTrace(
        'error',
        `${request?.method} ${request?.path} -> ${status} ${message}`,
        request?.traceId,
        'Exception',
      );
    }

    if (response.headersSent) return;

    response.status(status).json({
      code,
      message,
      data: null,
      traceId: request?.traceId,
      timestamp: Date.now(),
    });
  }
}
