import { Injectable, LoggerService, LogLevel } from '@nestjs/common';

/** 允许输出的日志级别顺序（越靠后越详细） */
const LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

interface LogPayload {
  level: LogLevel;
  time: string;
  context?: string;
  message: unknown;
  traceId?: string;
  stack?: string;
}

/**
 * 应用日志：生产环境输出 JSON（便于采集），开发环境输出可读单行
 * 说明：日志中禁止输出答题答案、openid 明文等敏感数据（隐私约束 2.4）
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly enabled: Set<LogLevel>;

  constructor(logLevel = 'log') {
    const index = LEVEL_ORDER.indexOf(logLevel as LogLevel);
    const maxIndex = index === -1 ? LEVEL_ORDER.indexOf('log') : index;
    this.enabled = new Set(LEVEL_ORDER.slice(0, maxIndex + 1));
  }

  log(message: unknown, context?: string): void {
    this.write({ level: 'log', time: new Date().toISOString(), message, context });
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write({ level: 'error', time: new Date().toISOString(), message, context, stack });
  }

  warn(message: unknown, context?: string): void {
    this.write({ level: 'warn', time: new Date().toISOString(), message, context });
  }

  debug(message: unknown, context?: string): void {
    this.write({ level: 'debug', time: new Date().toISOString(), message, context });
  }

  verbose(message: unknown, context?: string): void {
    this.write({ level: 'verbose', time: new Date().toISOString(), message, context });
  }

  /** 带链路 ID 的日志（由 RequestContextMiddleware 透传） */
  writeWithTrace(level: LogLevel, message: unknown, traceId?: string, context?: string): void {
    this.write({ level, time: new Date().toISOString(), message, traceId, context });
  }

  private write(payload: LogPayload): void {
    if (!this.enabled.has(payload.level)) return;

    if (process.env.NODE_ENV === 'production') {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    const trace = payload.traceId ? ` [${payload.traceId}]` : '';
    const ctx = payload.context ? ` [${payload.context}]` : '';
    const text =
      typeof payload.message === 'string' ? payload.message : JSON.stringify(payload.message);
    process.stdout.write(`${payload.level.toUpperCase()}${ctx}${trace} ${text}\n`);
    if (payload.stack) process.stdout.write(`${payload.stack}\n`);
  }
}
