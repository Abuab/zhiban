/**
 * 环境配置集中管理（规格《基础设施与部署方案》§4：密钥放环境变量，禁止进代码库）
 * 所有模块通过 ConfigService 读取，禁止在业务代码里直接读 process.env
 */
export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  /**
   * 监听地址（APP_HOST）
   * 默认 127.0.0.1：Nginx 与 API 同机部署，外部流量必须经反代进入，
   * 避免业务端口被绕过 Nginx 直连（安全基线 §4）
   */
  host: string;
  logLevel: string;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

/**
 * 管理后台配置（ADR-003）
 * 安全基线 §4：后台接口与小程序接口分离鉴权 → 后台独立签发 JWT，绝不与小程序共用密钥
 */
export interface AdminConfig {
  /** 后台 JWT 独立密钥（ADMIN_JWT_SECRET），与小程序 JWT_SECRET 物理隔离 */
  jwtSecret: string;
  jwtExpiresIn: string;
  /**
   * 应用层 IP 白名单总开关（ADMIN_IP_WHITELIST_ENABLED）
   * 语义为 **fail-closed**：只有显式写成 `false` 才关闭，未配置或写错值一律按开启处理
   * （若把「写错值」也当关闭，一次手误就等于把后台敞开）。
   * ⚠️ 本开关只管**应用层**；Nginx 的 allow/deny 是独立文件（.inc），不受它影响，两边需同步调整。
   */
  ipWhitelistEnabled: boolean;
  /**
   * 应用层 IP 白名单（ADMIN_ALLOWED_IPS，逗号分隔，可混用精确地址与 CIDR 网段）
   * 例：`203.0.113.7,10.0.0.0/8,2001:db8::/32`
   * 与 Nginx 的 allow/deny 构成双层防线（Nginx 为主防线）。
   * fail-closed：生产环境为空且开关开启时后台接口全部拒绝并打启动告警（避免「忘配 = 敞开」）
   */
  allowedIps: string[];
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  inviteWindowMs: number;
  inviteMax: number;
  /** 登录接口：按 IP 维度（同一出口 IP 下可能有多个真实用户，阈值放宽） */
  loginWindowMs: number;
  loginIpMax: number;
  /** 登录接口：按 openid 维度（防单账号刷登录/刷 msgSecCheck 配额，阈值收紧） */
  loginOpenidMax: number;
  /** 后台登录：按 IP 维度（窗口更长、阈值更严，防口令爆破，ADR-003） */
  adminLoginWindowMs: number;
  adminLoginIpMax: number;
}

export interface WechatConfig {
  appid: string;
  secret: string;
  subscribeTemplateInvite: string;
  /**
   * 邀请提醒订阅消息点击后跳转的小程序页面路径（WX_SUBSCRIBE_INVITE_PAGE）
   * 空值 = 不传 page，微信跳到首页；页面路径属端上路由，故不写死在服务端代码里
   */
  subscribeInvitePage: string;
  /**
   * 模拟登录开关（WX_MOCK_LOGIN）：未拿到小程序凭证前打通登录链路自测用
   * 安全约束：生产环境被 WechatService 强制忽略（可用任意 code 伪造账号）
   */
  mockEnabled: boolean;
}

export interface LlmConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

/**
 * 支付网关实现（ADR-007 决策 1）
 * - free：P1 全免费，下单即到账，不生成支付参数（默认）
 * - mock：模拟支付，回调走**同一套**验签 + 幂等代码路径（演练用）
 * - wechat：微信支付 V3（P2，需商户号与证书）
 */
export type PaymentGatewayKind = 'free' | 'mock' | 'wechat';

export interface PaymentConfig {
  gateway: PaymentGatewayKind;
  /** 未支付订单超时关闭分钟数（E3） */
  orderExpireMinutes: number;
  /** 兑换码有效期天数（E8） */
  couponExpireDays: number;
  /**
   * mock 网关的回调签名密钥（PAYMENT_MOCK_SIGN_KEY）
   * 只用于本地/联调演练，生产启用 mock 会被 env.validation 拒绝（等价于开放「白拿权益」后门）
   */
  mockSignKey: string;
  /** 微信支付 V3（PAYMENT_GATEWAY=wechat 时全部必填，缺失则启动即失败） */
  wechatPay: {
    mchId: string;
    /** APIv3 密钥，用于回调解密（AES-256-GCM） */
    apiV3Key: string;
    /** 商户证书序列号 */
    serialNo: string;
    /** 商户私钥文件路径（apiclient_key.pem） */
    privateKeyPath: string;
    /** 微信支付平台证书路径，用于回调验签 */
    platformCertPath: string;
    /** 支付结果通知地址 */
    notifyUrl: string;
  };
}

export interface AllConfig {
  app: AppConfig;
  jwt: JwtConfig;
  admin: AdminConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  rateLimit: RateLimitConfig;
  wechat: WechatConfig;
  llm: LlmConfig;
  payment: PaymentConfig;
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

export default (): AllConfig => {
  const env = process.env.NODE_ENV ?? 'development';
  return {
    app: {
      env,
      isProduction: env === 'production',
      port: toInt(process.env.APP_PORT, 3000),
      host: process.env.APP_HOST ?? '127.0.0.1',
      logLevel: process.env.APP_LOG_LEVEL ?? 'log',
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev_only_change_me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
    },
    admin: {
      // 不以 JWT_SECRET 兜底：两套密钥必须独立（ADR-003 决策 2）。
      // 非生产环境给一个显式的占位值，避免本地调试时后台完全不可用；生产缺失由 env.validation 直接拦截启动。
      jwtSecret:
        process.env.ADMIN_JWT_SECRET ??
        (env === 'production' ? '' : 'dev_only_admin_secret_change_me'),
      jwtExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '8h',
      // fail-closed 解析：只有明确写 false 才关闭（写错值/未配置都按开启）
      ipWhitelistEnabled:
        (process.env.ADMIN_IP_WHITELIST_ENABLED ?? '').trim().toLowerCase() !== 'false',
      allowedIps: (process.env.ADMIN_ALLOWED_IPS ?? '')
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    },
    database: {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: toInt(process.env.DB_PORT, 3306),
      username: process.env.DB_USER ?? 'zhiban',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_DATABASE ?? 'zhiban',
      synchronize: toBool(process.env.DB_SYNCHRONIZE, false),
      logging: toBool(process.env.DB_LOGGING, false),
    },
    redis: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: toInt(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: toInt(process.env.REDIS_DB, 0),
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'zhiban:',
    },
    rateLimit: {
      windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
      max: toInt(process.env.RATE_LIMIT_MAX, 120),
      inviteWindowMs: toInt(process.env.RATE_LIMIT_INVITE_WINDOW_MS, 60_000),
      inviteMax: toInt(process.env.RATE_LIMIT_INVITE_MAX, 20),
      loginWindowMs: toInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 60_000),
      loginIpMax: toInt(process.env.RATE_LIMIT_LOGIN_IP_MAX, 60),
      loginOpenidMax: toInt(process.env.RATE_LIMIT_LOGIN_OPENID_MAX, 20),
      // 后台登录：5 分钟窗口内 10 次（口令爆破成本远高于普通业务接口刷取）
      adminLoginWindowMs: toInt(process.env.ADMIN_LOGIN_WINDOW_MS, 300_000),
      adminLoginIpMax: toInt(process.env.ADMIN_LOGIN_IP_MAX, 10),
    },
    wechat: {
      appid: process.env.WX_APPID ?? '',
      secret: process.env.WX_SECRET ?? '',
      subscribeTemplateInvite: process.env.WX_SUBSCRIBE_TEMPLATE_INVITE ?? '',
      subscribeInvitePage: process.env.WX_SUBSCRIBE_INVITE_PAGE ?? '',
      mockEnabled: toBool(process.env.WX_MOCK_LOGIN, false),
    },
    llm: {
      apiBase: process.env.LLM_API_BASE ?? '',
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? '',
    },
    payment: {
      // 默认 free（P1 全免费）；取值合法性由 env.validation 把关，非法值不静默降级
      gateway: (process.env.PAYMENT_GATEWAY ?? 'free').trim().toLowerCase() as PaymentGatewayKind,
      orderExpireMinutes: toInt(process.env.PAYMENT_ORDER_EXPIRE_MINUTES, 30),
      couponExpireDays: toInt(process.env.PAYMENT_COUPON_EXPIRE_DAYS, 7),
      mockSignKey: process.env.PAYMENT_MOCK_SIGN_KEY ?? '',
      wechatPay: {
        mchId: process.env.WXPAY_MCH_ID ?? '',
        apiV3Key: process.env.WXPAY_API_V3_KEY ?? '',
        serialNo: process.env.WXPAY_SERIAL_NO ?? '',
        privateKeyPath: process.env.WXPAY_PRIVATE_KEY_PATH ?? '',
        platformCertPath: process.env.WXPAY_PLATFORM_CERT_PATH ?? '',
        notifyUrl: process.env.WXPAY_NOTIFY_URL ?? '',
      },
    },
  };
};
