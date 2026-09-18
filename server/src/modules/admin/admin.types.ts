import type { AdminRole } from './entities/admin-user.entity.js';

/**
 * 后台 JWT 载荷类型标记
 * 强校验意义：AdminAuthGuard 必须断言 payload.typ === 该值，
 *            即使将来误配成同一密钥，小程序 token 也无法冒充管理员令牌（ADR-003 决策 2）
 */
export const ADMIN_TOKEN_TYPE = 'admin' as const;

/** 后台 JWT 载荷 */
export interface AdminJwtPayload {
  /** admin_user.id */
  sub: string;
  username: string;
  role: AdminRole;
  /** 后台会话 id（admin_session:* 键） */
  sid: string;
  typ: typeof ADMIN_TOKEN_TYPE;
}

/** 后台登录成功返回体 */
export interface AdminLoginResult {
  token: string;
  /** token 有效期（秒），供前端提前续期判断 */
  expiresIn: number;
  admin: {
    id: number;
    username: string;
    role: AdminRole;
    /** false 表示尚未绑定二次验证 → 前端必须跳转绑定页 */
    totpEnabled: boolean;
  };
}

/** TOTP 绑定密钥下发体（setup 阶段，尚未落库） */
export interface AdminTotpSetupResult {
  /** Base32 密钥（供手动录入） */
  secret: string;
  /** otpauth:// URI（前端据此渲染二维码） */
  otpauthUrl: string;
}

/** 当前管理员资料（不含任何密钥字段） */
export interface AdminProfileResult {
  id: number;
  username: string;
  role: AdminRole;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
}

/** 后台接口的操作来源（审计留痕用） */
export interface AdminRequestMeta {
  ip?: string;
  userAgent?: string;
}
