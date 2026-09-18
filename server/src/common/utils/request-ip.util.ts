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
 *
 * 支持两种条目形式（同一个列表里可混用）：
 *   - 精确地址：`203.0.113.7`、`2001:db8::1`
 *   - 网段（CIDR）：`203.0.113.0/24`、`10.0.0.0/8`、`2001:db8::/32`
 * `::ffff:1.2.3.4` 与 `1.2.3.4` 视为同一地址
 * （Node 在双栈监听时会把 IPv4 客户端呈现为 IPv4-mapped IPv6 形式）
 *
 * 安全约定：任何非法条目（前缀越界、地址族不一致、拼写错误）一律按**不匹配**处理且不抛错
 *   —— 白名单是安全边界，解析失败必须往「拒绝」方向收敛，绝不能因为抛错而中断守卫或被绕过。
 */
export function isIpAllowed(ip: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return false;
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  return whitelist.some((entry) => matchesEntry(normalized, normalizeIp(entry)));
}

/** 单条白名单条目：含 '/' 视为 CIDR 网段，否则视为精确地址 */
function matchesEntry(ip: string, entry: string): boolean {
  if (!entry) return false;
  const slash = entry.lastIndexOf('/');
  if (slash === -1) return ip === entry;
  return matchCidr(ip, entry.slice(0, slash), entry.slice(slash + 1));
}

/** 按 CIDR 前缀比较；地址族不同（v4 对 v6）或前缀非法时返回 false */
function matchCidr(ip: string, base: string, prefixText: string): boolean {
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);

  const ipV4 = ipv4ToInt(ip);
  const baseV4 = ipv4ToInt(base);
  if (ipV4 !== null && baseV4 !== null) {
    if (prefix > 32) return false;
    // 注意 prefix=0 需特判：JS 位移的移位量按 32 取模，`0xffffffff << 32` 会回到自身而掩不住任何位
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((ipV4 & mask) >>> 0) === ((baseV4 & mask) >>> 0);
  }

  const ipV6 = ipv6ToBigInt(ip);
  const baseV6 = ipv6ToBigInt(base);
  if (ipV6 !== null && baseV6 !== null) {
    if (prefix > 128) return false;
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return (ipV6 & mask) === (baseV6 & mask);
  }

  return false;
}

/** 去掉 IPv4-mapped IPv6 前缀，统一为可比对的形式 */
function normalizeIp(ip: string): string {
  const trimmed = (ip ?? '').trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}

/** 点分十进制 IPv4 → 32 位无符号整数；非法返回 null */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** IPv6 字面量 → 128 位整数；非法返回 null */
function ipv6ToBigInt(ip: string): bigint | null {
  const groups = expandIpv6(ip);
  if (!groups) return null;
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

/**
 * 把 IPv6 字面量展开为 8 组十六进制（处理 `::` 缩写与 `::ffff:1.2.3.4` 内嵌 IPv4）；非法返回 null
 */
function expandIpv6(ip: string): string[] | null {
  if (!ip.includes(':')) return null;
  if ((ip.match(/::/g) ?? []).length > 1) return null;

  let text = ip;
  // 尾部内嵌 IPv4（如 ::ffff:1.2.3.4、::1.2.3.4）：折算成两段十六进制再统一处理
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    const embedded = ipv4ToInt(text.slice(lastColon + 1));
    if (embedded === null) return null;
    const high = ((embedded >>> 16) & 0xffff).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon)}:${high}:${low}`;
  }

  const [headText = '', tailText] = text.split('::');
  const head = headText ? headText.split(':') : [];
  // tailText 为 undefined 表示没有 `::` 缩写
  const tail = tailText ? tailText.split(':') : [];

  if (![...head, ...tail].every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;

  const explicit = head.length + tail.length;
  if (tailText === undefined) return explicit === 8 ? head : null;
  // `::` 至少代表 1 组 0，故显式组数必须少于 8
  if (explicit > 7) return null;
  return [...head, ...new Array<string>(8 - explicit).fill('0'), ...tail];
}
