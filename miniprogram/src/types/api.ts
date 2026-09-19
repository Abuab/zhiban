/**
 * 接口层通用类型
 * 与服务端对应文件保持一致（改动需同步两端）：
 *   - server/src/common/dto/api-response.dto.ts
 *   - server/src/modules/account/account.types.ts
 *   - server/src/modules/auth/auth.types.ts
 */

/** 统一响应体 */
export interface ApiResponse<T> {
  /** 业务错误码，0 = 成功 */
  code: number;
  message: string;
  data: T;
  /** 链路 ID，报障时提供给客服便于定位 */
  traceId?: string;
  timestamp: number;
}

/** 昵称状态：pending_review 时需提示「审核中，暂未生效」 */
export type NicknameStatus = 'ok' | 'pending_review' | 'rejected';

/** 用户资料（不含 openid 等账号标识，接口最小化暴露） */
export interface UserProfile {
  id: number;
  nickname: string | null;
  nicknameStatus: NicknameStatus;
  avatarUrl: string | null;
  /** 是否已确认年满 18 */
  ageConfirmed: boolean;
  /** 是否已同意隐私政策 */
  privacyAgreed: boolean;
  privacyPolicyVersion: string | null;
  createdAt: string;
}

/** 登录 / 续期返回 */
export interface LoginResult {
  token: string;
  tokenType: 'Bearer';
  /** token 有效期（秒） */
  expiresIn: number;
  isNewUser: boolean;
  user: UserProfile;
}

/** 资料更新入参（未传字段不变更） */
export interface UpdateProfileInput {
  nickname?: string;
  avatarUrl?: string;
  privacyAgreed?: boolean;
  privacyPolicyVersion?: string;
  ageConfirmed?: boolean;
}

/** 资料更新返回 */
export interface UpdateProfileResult {
  profile: UserProfile;
  /** 昵称提示文案（命中审核池时返回） */
  nicknameNotice?: string;
}

/**
 * 站点公开配置（GET /v1/config/public，ADR-002）
 * 与库中 sys_config 的点分键一致：brand.name → brand.name
 * 免鉴权接口，登录前即可获取；字段缺失时前端必须用兜底值（ADR-002 决策 4）
 * 值的类型由服务端按 sys_config.value_type 解释（ADR-010 决策 3）
 */
export interface PublicConfig {
  /** 品牌展示配置（对应库中 brand.* 键） */
  brand?: {
    /** 品牌名：登录页主标题、授权弹窗、隐私政策页标题、首页导航栏标题 */
    name?: string;
  };
  /** 隐私与安全检查（对应库中 safety.* 键，ADR-010） */
  safety?: {
    /** 婚前事实确认清单（json 字符串数组；运营可改，端上有兜底） */
    selfcheck?: {
      items?: string[];
    };
  };
  /**
   * 客服（对应库中 support.* 键，ADR-010 决策 5）
   * 键名沿用点分键段名（下划线形式），端上由 stores/app-config.ts 转成驼峰后再使用
   */
  support?: {
    /** 客服二维码图片地址（须为 https；非法即视为未配置） */
    qrcode_url?: string;
    /** 二维码下方说明文案 */
    qrcode_tip?: string;
  };
}

/**
 * 报告文案区块的渲染结果（镜像 server/src/engines/report/report.types.ts）
 * 文案本体由服务端从 report_template_block 读出并渲染占位符，小程序端只负责排版展示
 * —— 落实宪法 P5「改文案零发版」。
 */
export interface RenderedBlock {
  /** 区块键：INTRO / 维度编码（如 FINANCE）/ LOCK_HINT（付费墙，单独下发） */
  blockKey: string;
  orderNo: number;
  /** 渲染后的文本 */
  text: string;
  /** 是否达到内容详实度下限（未设置下限时为 true） */
  meetsMinChars: boolean;
  /** 渲染后仍缺失的占位符名（正常为空数组，用于运营排查） */
  missingKeys: string[];
}
