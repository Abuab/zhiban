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
  /** 后台商品变更（价格 / 名称 / 状态 / iOS 可见性 / 权益载荷，模块 6） */
  PRODUCT_UPDATE: 'product_update',
  /** 后台批量生成兑换码（模块 6） */
  COUPON_GENERATE: 'coupon_generate',
  /** 后台手工补发权益（模块 6，E1 漏单兜底） */
  ENTITLEMENT_GRANT: 'entitlement_grant',
  /** 后台退款（模块 6，E7/E10） */
  ORDER_REFUND: 'order_refund',
  /** 后台补单：按订单号查单入账（模块 6，E1） */
  ORDER_RESTORE: 'order_restore',
  /** 后台编辑议题（模块 7 内容域：标题 / 副标题 / 挂载维度 / 排序 / 上下架） */
  TOPIC_UPDATE: 'topic_update',
  /** 后台新增锦囊卡片（模块 7 内容域） */
  TOPIC_CARD_CREATE: 'topic_card_create',
  /** 后台编辑锦囊卡片（模块 7 内容域：正文 / 选项 / 卡序 / 上下架） */
  TOPIC_CARD_UPDATE: 'topic_card_update',
  /** C 端生成 AI 专属卡（模块 7，§9.3「生成行为记入审计日志」） */
  EXCLUSIVE_CARD_GENERATE: 'exclusive_card_generate',
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
 * target_id 字段在库中为 VARCHAR(64)，必须截断
 * 真实场景：AdminIpGuard 会把 request.path 记为 target_id，而 `:configKey` 是用户可控路径段，
 * 构造 `/api/admin/configs/<200 字符>` 即可超出列长 → 严格模式下插入报错 → 该条审计被本服务的
 * try/catch 吞掉，**正好丢掉最需要留痕的「越权尝试」记录**。
 */
const TARGET_ID_MAX_LENGTH = 64;

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
        targetId: input.targetId?.slice(0, TARGET_ID_MAX_LENGTH) ?? null,
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
