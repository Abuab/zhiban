import type { Request } from 'express';

/**
 * 可信任的反代来源：仅本机回环地址
 * 当前部署形态为「Nginx 与 API 同机」，反代必然以 127.0.0.1 回源；
 * 公网直连（含被绕过 Nginx 直打端口）一律不采信 X-Forwarded-For
 */
export const TRUSTED_PROXY_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 解析客户端真实 IP
 *
 * 安全约束（防刷基线）：X-Forwarded-For 是客户端可任意伪造的请求头，
 *   只有「直连方是本机可信反代（Nginx 与 API 同机）」时才采信，并取最后一段
 *   （Nginx 用 $remote_addr 覆写该头后，最后一段即真实客户端 IP）。
 *   若不加这层判断，恶意客户端每次换一个伪造 IP 就能拿到全新限流桶 / 绕过 IP 白名单。
 *
 * 说明：限流守卫与后台 IP 白名单守卫共用本函数——白名单若允许解析出伪造 IP，
 *       等于把后台开放给任何人，两处必须保持完全一致，故不各自实现。
 * 注意：将来若前置 CDN，需要把 CDN 回源地址加入可信列表，否则会退化为按 CDN 节点计数。
 */
export function resolveClientIp(request: Request): string {
  const direct = request.socket?.remoteAddress ?? request.ip ?? '';
  if (!TRUSTED_PROXY_ADDRESSES.has(direct)) {
    return direct || 'unknown';
  }

  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const hops = (raw ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);

  return hops.length > 0 ? (hops[hops.length - 1] as string) : direct;
}

/**
 * 判断客户端 IP 是否命中白名单
 * 支持 IPv4 与 IPv6 字面量精确匹配；`::ffff:1.2.3.4` 与 `1.2.3.4` 视为同一地址
 * （Node 在双栈监听时会把 IPv4 客户端呈现为 IPv4-mapped IPv6 形式）
 */
export function isIpAllowed(ip: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return false;
  const normalized = normalizeIp(ip);
  return whitelist.some((entry) => normalizeIp(entry) === normalized);
}

/** 去掉 IPv4-mapped IPv6 前缀，统一为可比对的形式 */
function normalizeIp(ip: string): string {
  const trimmed = (ip ?? '').trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}
