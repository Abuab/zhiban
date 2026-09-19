/**
 * 环境变量校验：启动即暴露配置错误，避免带病运行
 * 依据规格《基础设施与部署方案》§4 安全基线
 */
const REQUIRED_KEYS = ['DB_HOST', 'DB_USER', 'DB_DATABASE', 'REDIS_HOST'] as const;

export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const env = String(raw.NODE_ENV ?? 'development');
  const errors: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!raw[key]) errors.push(`缺少必填环境变量 ${key}`);
  }

  // 数值型配置必须是合法数字
  const numericKeys = [
    'APP_PORT',
    'DB_PORT',
    'REDIS_PORT',
    'RATE_LIMIT_MAX',
    'RATE_LIMIT_INVITE_MAX',
    'RATE_LIMIT_LOGIN_IP_MAX',
    'RATE_LIMIT_LOGIN_OPENID_MAX',
    'ADMIN_LOGIN_WINDOW_MS',
    'ADMIN_LOGIN_IP_MAX',
    'PAYMENT_ORDER_EXPIRE_MINUTES',
    'PAYMENT_COUPON_EXPIRE_DAYS',
  ];
  for (const key of numericKeys) {
    const value = raw[key];
    if (value !== undefined && value !== '' && !Number.isFinite(Number(value))) {
      errors.push(`环境变量 ${key} 必须是数字，当前值：${String(value)}`);
    }
  }

  validatePaymentEnv(raw, env, errors);

  if (env === 'production') {
    if (!raw.JWT_SECRET || raw.JWT_SECRET === 'dev_only_change_me') {
      errors.push('生产环境 JWT_SECRET 必须设置为强随机值');
    }
    // 后台密钥独立且不可弱（ADR-003 决策 2）：空值等于允许任何人伪造管理员令牌
    const adminSecret = String(raw.ADMIN_JWT_SECRET ?? '');
    if (!adminSecret || adminSecret === 'dev_only_admin_secret_change_me') {
      errors.push('生产环境 ADMIN_JWT_SECRET 必须设置为强随机值（不得与 JWT_SECRET 相同）');
    } else if (adminSecret.length < 32) {
      errors.push('生产环境 ADMIN_JWT_SECRET 长度至少 32 位');
    } else if (adminSecret === raw.JWT_SECRET) {
      errors.push('ADMIN_JWT_SECRET 不得与 JWT_SECRET 相同（后台与小程序必须分离鉴权）');
    }
    // 注意：ADMIN_ALLOWED_IPS 为空不阻断启动 —— 后台不可用不应拖垮小程序接口；
    //       AdminIpGuard 在生产环境对空名单 fail-closed（后台全部拒绝），并在启动时打告警日志
    if (raw.DB_SYNCHRONIZE === 'true') {
      errors.push('生产环境禁止开启 DB_SYNCHRONIZE，表结构由 docs/schema.sql 管理');
    }
    if (raw.DB_LOGGING === 'true') {
      errors.push('生产环境禁止开启 DB_LOGGING，避免答题数据落日志（隐私约束 2.4）');
    }
    if (raw.WX_MOCK_LOGIN === 'true') {
      // 模拟登录可用任意 code 伪造账号，生产开启等于开放任意登录后门
      errors.push('生产环境禁止开启 WX_MOCK_LOGIN（模拟登录仅限本地/联调环境）');
    }
  }

  if (errors.length > 0) {
    throw new Error(`环境变量校验失败：\n- ${errors.join('\n- ')}`);
  }

  return raw;
}

/** 支付网关取值的合法集合（ADR-007 决策 1） */
const PAYMENT_GATEWAYS = new Set(['free', 'mock', 'wechat']);

/** 微信支付 V3 启用时必填的配置项 */
const WXPAY_REQUIRED_KEYS = [
  'WXPAY_MCH_ID',
  'WXPAY_API_V3_KEY',
  'WXPAY_SERIAL_NO',
  'WXPAY_PRIVATE_KEY_PATH',
  'WXPAY_PLATFORM_CERT_PATH',
  'WXPAY_NOTIFY_URL',
] as const;

/**
 * 支付网关配置校验（ADR-007 决策 1）
 * 为什么启动即拦：选错网关的后果是不对称的 ——
 *   mock 在生产可用共享密钥伪造「已支付」回调（白拿权益），
 *   wechat 缺证书则回调全部验签失败（用户扣款不到账），
 * 两者都不该等到第一笔真实交易才暴露。
 */
function validatePaymentEnv(
  raw: Record<string, unknown>,
  env: string,
  errors: string[],
): void {
  const gateway = String(raw.PAYMENT_GATEWAY ?? 'free').trim().toLowerCase();

  if (!PAYMENT_GATEWAYS.has(gateway)) {
    errors.push(
      `PAYMENT_GATEWAY 只能是 free / mock / wechat，当前值：${String(raw.PAYMENT_GATEWAY)}`,
    );
    return;
  }

  if (gateway === 'mock') {
    if (env === 'production') {
      errors.push('生产环境禁止使用 PAYMENT_GATEWAY=mock（模拟支付仅限本地/联调演练）');
    }
    if (!raw.PAYMENT_MOCK_SIGN_KEY) {
      errors.push('PAYMENT_GATEWAY=mock 时必须设置 PAYMENT_MOCK_SIGN_KEY');
    }
  }

  if (gateway === 'wechat') {
    for (const key of WXPAY_REQUIRED_KEYS) {
      if (!raw[key]) errors.push(`PAYMENT_GATEWAY=wechat 时必须设置 ${key}`);
    }
  }
}
