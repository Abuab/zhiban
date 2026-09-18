import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { AuditLogEntity, type AuditActorType } from './entities/audit-log.entity.js';

/** 审计动作标识（集中登记，避免各处拼字符串导致检索口径不一致） */
export const AuditAction = {
  /** 后台登录成功 */
  ADMIN_LOGIN: 'admin_login',
  /** 后台登录失败（账号不存在 / 口令错误 / 动态码错误 / 账号停用） */
  ADMIN_LOGIN_FAILED: 'admin_login_failed',
  /** 后台退出登录 */
  ADMIN_LOGOUT: 'admin_logout',
  /** 后台越权尝试：来源 IP 不在白名单 */
  ADMIN_IP_DENIED: 'admin_ip_denied',
  /** 后台二次验证绑定成功 */
  ADMIN_TOTP_ENABLED: 'admin_totp_enabled',
  /** 后台配置项变更 */
  CONFIG_UPDATE: 'config_update',
} as const;

export interface AuditRecordInput {
  actorType: AuditActorType;
  actorId?: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** user_agent 字段在库中为 VARCHAR(256)，超长直接截断避免插入报错 */
const USER_AGENT_MAX_LENGTH = 256;

/**
 * 审计日志写入（表 audit_log）
 * 规格依据：《基础设施与部署方案》§4 —— 审计覆盖「后台配置变更、越权尝试」等
 * 设计约束：
 *   1. 写入失败**不得阻断业务**：审计是旁路，配置改动本身已成功提交，不能因为日志失败回滚
 *      （但必须打 error 日志，便于人工补记）
 *   2. 只增不改不删：本服务不提供更新与删除方法
 *   3. detail 中禁止写入口令、密钥、完整 token
 */
@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
    private readonly logger: AppLogger,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      const entity = this.repository.create({
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detailJson: input.detail ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      });
      await this.repository.save(entity);
    } catch (error) {
      this.logger.error(
        `审计日志写入失败（action=${input.action}）：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'AuditLogService',
      );
    }
  }
}
