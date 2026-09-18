import type { AppRequest } from '../../common/types/request-context.js';
import { resolveClientIp } from '../../common/utils/request-ip.util.js';
import type { AdminRequestMeta } from './admin.types.js';

/**
 * 构造后台操作来源信息（审计留痕用）
 * IP 必须走 resolveClientIp：审计与 IP 白名单、限流必须使用同一个「真实客户端 IP」口径，
 * 否则会出现「白名单放行了 A，审计却记录成 B」的排查困境
 */
export function buildAdminRequestMeta(request: AppRequest): AdminRequestMeta {
  return {
    ip: resolveClientIp(request),
    userAgent: request.headers['user-agent'],
  };
}
