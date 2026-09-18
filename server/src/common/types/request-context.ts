import type { Request } from 'express';

/** 登录态载荷：模块 2 微信登录后由 JWT 解出 */
export interface AuthUser {
  /** user.id */
  id: number;
  /** 微信 openid（限流键、权益归属均以此为准） */
  openid?: string;
}

/** 请求上下文扩展：traceId 用于链路追踪，user 由 AuthGuard 注入 */
export interface AppRequest extends Request {
  traceId?: string;
  user?: AuthUser;
}
