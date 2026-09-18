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
  const numericKeys = ['APP_PORT', 'DB_PORT', 'REDIS_PORT', 'RATE_LIMIT_MAX'];
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
    if (raw.DB_SYNCHRONIZE === 'true') {
      errors.push('生产环境禁止开启 DB_SYNCHRONIZE，表结构由 docs/schema.sql 管理');
    }
    if (raw.DB_LOGGING === 'true') {
      errors.push('生产环境禁止开启 DB_LOGGING，避免答题数据落日志（隐私约束 2.4）');
    }
  }

  if (errors.length > 0) {
    throw new Error(`环境变量校验失败：\n- ${errors.join('\n- ')}`);
  }

  return raw;
}
