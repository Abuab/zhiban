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
  ];
  for (const key of numericKeys) {
    const value = raw[key];
    if (value !== undefined && value !== '' && !Number.isFinite(Number(value))) {
      errors.push(`环境变量 ${key} 必须是数字，当前值：${String(value)}`);
    }
  }

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
