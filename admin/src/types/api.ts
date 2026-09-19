/**
 * 接口层通用类型
 * 与服务端保持一致（改动需同步两端）：
 *   - server/src/common/dto/api-response.dto.ts
 *   - server/src/modules/admin/admin.types.ts
 *   - server/src/modules/admin/admin-config.service.ts
 */

/** 统一响应体 */
export interface ApiResponse<T> {
  /** 业务错误码，0 = 成功 */
  code: number;
  message: string;
  data: T;
  /** 链路 ID，报障时提供给运维便于定位 */
  traceId?: string;
  timestamp: number;
}

/** 管理员角色 */
export type AdminRole = 'super' | 'operator';

/** 管理员身份信息（登录返回体中的 admin 字段） */
export interface AdminIdentity {
  id: number;
  username: string;
  role: AdminRole;
  /** false 表示尚未绑定二次验证，前端必须跳转绑定页 */
  totpEnabled: boolean;
}

/** 当前管理员资料（GET /admin/auth/profile） */
export interface AdminProfile extends AdminIdentity {
  /** 上次登录时间，从未登录过为 null */
  lastLoginAt: string | null;
}

/** 后台登录入参 */
export interface AdminLoginInput {
  username: string;
  password: string;
  /** 动态码；已绑定二次验证时必填 */
  totpCode?: string;
}

/** 后台登录返回 */
export interface AdminLoginResult {
  token: string;
  /** token 有效期（秒） */
  expiresIn: number;
  admin: AdminIdentity;
}

/** 二次验证绑定密钥（setup 阶段，服务端尚未落库） */
export interface TotpSetupResult {
  /** Base32 密钥，供扫码失败时手动录入 */
  secret: string;
  /** otpauth:// URI，前端据此渲染二维码 */
  otpauthUrl: string;
}

/** 站点公开配置（GET /v1/config/public，免鉴权） */
export interface PublicConfig {
  /** 品牌展示配置；字段缺失时前端必须用兜底值 */
  brand?: {
    name?: string;
  };
}

/** 配置分组（GET /admin/configs/groups） */
export interface ConfigGroup {
  group: string;
  count: number;
}

/** 配置值类型 */
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'json';

/** 站点配置行（后台视图） */
export interface AdminConfigItem {
  id: number;
  /** 配置键，点分层级，如 brand.name */
  configKey: string;
  /** 配置值（服务端统一按字符串存储） */
  configValue: string;
  /** 分组：brand / site / contact */
  configGroup: string;
  valueType: ConfigValueType;
  /** 1 = 可被免鉴权接口下发 */
  isPublic: 0 | 1;
  description: string | null;
  updatedBy: number | null;
  updatedAt: string;
}

/** 配置分页列表返回 */
export interface ConfigListResult {
  items: AdminConfigItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 配置列表查询参数 */
export interface ConfigListQuery {
  /** 分组筛选，不传表示全部 */
  group?: string;
  page?: number;
  pageSize?: number;
}

/** 配置编辑入参（至少传一项） */
export interface UpdateConfigInput {
  configValue?: string;
  isPublic?: 0 | 1;
  description?: string;
}

/**
 * 图片上传返回（POST /admin/uploads/image，ADR-010 决策 5）
 * url 为服务端拼好的绝对 https 地址，可直接粘进配置值
 */
export interface UploadImageResult {
  url: string;
}
