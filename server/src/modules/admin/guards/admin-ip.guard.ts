import { CanActivate, ExecutionContext, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/constants/error-code.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { AppLogger } from '../../../common/logger/app-logger.service.js';
import type { AppRequest } from '../../../common/types/request-context.js';
import { isIpAllowed, resolveClientIp } from '../../../common/utils/request-ip.util.js';
import { AuditAction, AuditLogService } from '../../audit/audit-log.service.js';

/**
 * 后台 IP 白名单守卫（ADR-003 决策 3）
 *
 * 双层防线的第二层：Nginx 的 allow/deny 是第一层（外部请求在到达应用前就被拒），
 * 本守卫保证「Nginx 配置被改动/回滚而漏掉白名单」时后台仍不可达。
 *
 * 白名单条目支持精确地址与 CIDR 网段混用（见 request-ip.util 的 isIpAllowed）。
 *
 * fail-closed 语义：
 *   - 总开关（ADMIN_IP_WHITELIST_ENABLED）：只有显式写 `false` 才关闭本守卫；关闭时放行但启动打 error 日志
 *   - 生产环境 + 名单为空 → 全部拒绝（避免「忘配 = 敞开」）
 *   - 非生产环境 + 名单为空 → 放行（本地开发不必先配白名单）
 *
 * 必须挂在**类级**，且顺序在 AdminAuthGuard 之前 —— IP 不合法时不必浪费 CPU 做 JWT 校验。
 */
@Injectable()
export class AdminIpGuard implements CanActivate, OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    if (!this.isProduction) return;

    if (!this.enabled) {
      this.logger.error(
        'ADMIN_IP_WHITELIST_ENABLED=false：生产环境已关闭应用层 IP 白名单。'
          + '此时 Nginx 的 allow/deny 是唯一来源限制（本开关不影响它），'
          + '若 Nginx 侧也已放开，后台将只剩「口令 + 二次验证」两道防线',
        undefined,
        'AdminIpGuard',
      );
      return;
    }

    if (this.whitelist.length === 0) {
      this.logger.error(
        'ADMIN_ALLOWED_IPS 未配置：生产环境后台接口将全部拒绝（fail-closed）。'
          + '请在 server/.env 配置允许来源 IP 或 CIDR 网段后重启服务',
        undefined,
        'AdminIpGuard',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 总开关关闭：直接放行（是否关闭由 env 显式决定，生产关闭会在启动时打 error 日志）
    if (!this.enabled) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const ip = resolveClientIp(request);

    if (this.whitelist.length === 0) {
      if (!this.isProduction) return true;
      await this.deny(ip, request, 'whitelist_empty');
    } else if (!isIpAllowed(ip, this.whitelist)) {
      await this.deny(ip, request, 'ip_not_allowed');
    }

    return true;
  }

  /** 越权尝试留痕（安全基线 §4 审计要求）：写审计后再拒绝 */
  private async deny(ip: string, request: AppRequest, reason: string): Promise<never> {
    await this.auditLog.record({
      actorType: 'admin',
      action: AuditAction.ADMIN_IP_DENIED,
      targetType: 'admin_endpoint',
      targetId: request.path,
      detail: { reason, ip },
      ip,
      userAgent: request.headers['user-agent'],
    });
    throw new BusinessException(ErrorCode.IP_FORBIDDEN, undefined, HttpStatus.FORBIDDEN);
  }

  private get whitelist(): string[] {
    return this.config.get<string[]>('admin.allowedIps') ?? [];
  }

  /**
   * 总开关：仅当配置值严格等于 false 才视为关闭
   * 用 `!== false` 而非 `=== true`，保证配置缺失/写错时仍然按「开启白名单」处理（fail-closed）
   */
  private get enabled(): boolean {
    return this.config.get<boolean>('admin.ipWhitelistEnabled') !== false;
  }

  private get isProduction(): boolean {
    return this.config.get<boolean>('app.isProduction') === true;
  }
}
