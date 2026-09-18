import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ErrorCode, ErrorMessage } from '../constants/error-code.js';
import type { ApiResponse } from '../dto/api-response.dto.js';
import type { AppRequest } from '../types/request-context.js';

/**
 * 统一响应格式：{ code, message, data, traceId, timestamp }
 * 二进制流（StreamableFile）与非对象返回值不做包装
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          code: ErrorCode.SUCCESS,
          message: ErrorMessage[ErrorCode.SUCCESS],
          data,
          traceId: request.traceId,
          timestamp: Date.now(),
        };
      }),
    );
  }
}
