/**
 * 数据库错误判定工具
 */

/** 唯一键冲突（MySQL ER_DUP_ENTRY）——用于把并发首登收敛为幂等建档 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: string; driverError?: { code?: string } };
  return record.code === 'ER_DUP_ENTRY' || record.driverError?.code === 'ER_DUP_ENTRY';
}
