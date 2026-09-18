/**
 * 环境配置集中管理（规格《基础设施与部署方案》§4：密钥放环境变量，禁止进代码库）
 * 所有模块通过 ConfigService 读取，禁止在业务代码里直接读 process.env
 */
export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  logLevel: string;
  adminAllowedIps: string[];
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
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
}

export interface WechatConfig {
  appid: string;
  secret: string;
  subscribeTemplateInvite: string;
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

export interface AllConfig {
  app: AppConfig;
  jwt: JwtConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  rateLimit: RateLimitConfig;
  wechat: WechatConfig;
  llm: LlmConfig;
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
      logLevel: process.env.APP_LOG_LEVEL ?? 'log',
      adminAllowedIps: (process.env.ADMIN_ALLOWED_IPS ?? '')
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev_only_change_me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
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
    },
    wechat: {
      appid: process.env.WX_APPID ?? '',
      secret: process.env.WX_SECRET ?? '',
      subscribeTemplateInvite: process.env.WX_SUBSCRIBE_TEMPLATE_INVITE ?? '',
      mockEnabled: toBool(process.env.WX_MOCK_LOGIN, false),
    },
    llm: {
      apiBase: process.env.LLM_API_BASE ?? '',
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? '',
    },
  };
};
