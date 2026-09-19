import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import {
  ConsentLogEntity,
  type ConsentRole,
  type ConsentType,
} from './entities/consent-log.entity.js';

/** 一次同意留证的写入入参 */
export interface ConsentLogInput {
  /** 同意主体 user.id */
  userId: number;
  consentType: ConsentType;
  /** 配对级同意的关联邀请；账号级同意为 null */
  inviteId?: number | null;
  /** initiator / invitee（配对级必填） */
  role?: ConsentRole | null;
  policyVersion: string;
  /** true 同意 / false 拒绝（拒绝同样留证） */
  agreed: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

/** user_agent 字段在库中为 VARCHAR(256)，超长直接截断避免插入报错（对齐 audit_log） */
const USER_AGENT_MAX_LENGTH = 256;

/** ip 字段在库中为 VARCHAR(64)；来源可被可信反代后的 X-Forwarded-For 影响，故同样截断兜底 */
const IP_MAX_LENGTH = 64;

/** 留证写入失败时对用户的报错文案（ADR-012 风险表：无留证的同意等于没有同意） */
export const CONSENT_LOG_FAILED_MESSAGE = '服务繁忙，请重试';

/**
 * 同意留证服务（consent_log 表的唯一出口；ADR-012）
 *
 * ⚠️ 与 `AuditLogService` 的语义**相反**：审计是旁路（写失败静默吞掉），
 * 本服务写失败必须抛错——同意动作若无法留证，则该次同意**不生效**。
 * 这是 `consent_log` 这张表存在的全部意义，不可改成 try/catch 吞异常。
 *
 * `record()` 支持传入事务 `EntityManager`：调用方（create / replace / consent）
 * 必须让留证与业务写入落在**同一事务**，任一失败即整体回滚。
 */
@Injectable()
export class ConsentLogService {
  constructor(
    @InjectRepository(ConsentLogEntity)
    private readonly repository: Repository<ConsentLogEntity>,
    private readonly logger: AppLogger,
  ) {}

  async record(input: ConsentLogInput, manager?: EntityManager): Promise<void> {
    const repository = manager ? manager.getRepository(ConsentLogEntity) : this.repository;
    try {
      await repository.save(
        repository.create({
          userId: input.userId,
          consentType: input.consentType,
          inviteId: input.inviteId ?? null,
          role: input.role ?? null,
          policyVersion: input.policyVersion,
          agreed: input.agreed ? 1 : 0,
          ip: input.ip ? input.ip.slice(0, IP_MAX_LENGTH) : null,
          userAgent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
        }),
      );
    } catch (error) {
      // 失败即抛错阻断业务（有意为之，见类注释）；不写库成功就不允许同意生效
      this.logger.error(
        `同意留证写入失败（userId=${input.userId} type=${input.consentType} inviteId=${input.inviteId ?? 'null'}）：` +
          `${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'ConsentLogService',
      );
      throw new BusinessException(ErrorCode.INTERNAL_ERROR, CONSENT_LOG_FAILED_MESSAGE);
    }
  }
}
