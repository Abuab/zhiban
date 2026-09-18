/** 时间单位 → 秒 */
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** 默认 30 天（与 JWT_EXPIRES_IN 默认值一致） */
const DEFAULT_SECONDS = 30 * 86400;

/**
 * 将 '30d' / '12h' / '30m' / '60s' / 纯数字（视为秒）解析为秒数
 * 用途：JwtModule 的 expiresIn（字符串）与 Redis 会话 TTL（秒）必须保持一致，
 *      否则会出现「JWT 未过期但会话已被 Redis 清除」的判断歧义
 */
export function parseDurationToSeconds(value: string, fallbackSeconds = DEFAULT_SECONDS): number {
  const matched = /^(\d+)\s*([smhd])?$/i.exec((value ?? '').trim());
  if (!matched) return fallbackSeconds;
  const amount = Number.parseInt(matched[1], 10);
  const unit = (matched[2] ?? 's').toLowerCase();
  return amount * (UNIT_SECONDS[unit] ?? 1);
}
