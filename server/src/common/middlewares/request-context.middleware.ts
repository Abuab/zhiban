import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppLogger } from '../logger/app-logger.service.js';
import type { AppRequest } from '../types/request-context.js';

export const TRACE_HEADER = 'x-trace-id';

/**
 * 请求上下文中间件：注入链路 ID + 输出访问日志
 * 挂载方式：在 main.ts 通过 app.use() 全局挂载（早于路由与守卫执行，因此异常日志也带 traceId）
 * 隐私注意：只记录 req.path，不记录 query —— 避免邀请码、答案等参数落日志（边界总表 C8 / 隐私约束 2.4）
 */
export function createRequestContextMiddleware(logger: AppLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const appRequest = req as AppRequest;
    const incoming = req.headers[TRACE_HEADER];
    const traceId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    appRequest.traceId = traceId;
    res.setHeader(TRACE_HEADER, traceId);

    const startedAt = Date.now();
    res.on('finish', () => {
      const cost = Date.now() - startedAt;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      logger.writeWithTrace(
        level,
        `${req.method} ${req.path} ${res.statusCode} ${cost}ms`,
        traceId,
        'HTTP',
      );
    });

    next();
  };
}
