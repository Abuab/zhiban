import type { Request } from 'express';
import type { AdminRole } from '../../modules/admin/entities/admin-user.entity.js';

/** 登录态载荷：模块 2 微信登录后由 JWT 解出（Redis 会话校验通过才会注入） */
export interface AuthUser {
  /** user.id */
  id: number;
  /** 微信 openid（限流键、权益归属均以此为准） */
  openid?: string;
  /** 当前设备会话 id（退出登录 / 按设备撤销用，A3 多设备各自独立） */
  sessionId?: string;
}

/**
 * 后台管理员身份（ADR-003 决策 2）
 * 与 AuthUser 完全独立：由 AdminAuthGuard 注入，绝不与小程序登录态混用
 */
export interface AdminUser {
  /** admin_user.id */
  id: number;
  username: string;
  role: AdminRole;
  /** 后台会话 id（admin_session:* 键） */
  sessionId: string;
  /** 是否已完成二次验证绑定（false 时仅可访问 TOTP 绑定相关接口） */
  totpEnabled: boolean;
}

/** 请求上下文扩展：traceId 用于链路追踪，user / admin 分别由两个守卫注入 */
export interface AppRequest extends Request {
  traceId?: string;
  user?: AuthUser;
  admin?: AdminUser;
}
