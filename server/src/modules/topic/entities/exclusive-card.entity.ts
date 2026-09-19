import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 禁词/P7 审校结果（exclusive_card.check_result） */
export interface ExclusiveCardCheckResult {
  /** 是否通过校验 */
  passed: boolean;
  /** 命中的敏感词（已去重；不含命中的具体上下文，避免把敏感内容二次落库） */
  hits: string[];
  /** 实际模型调用次数（0 = 未调模型即降级；上限见 `EXCLUSIVE_CARD_MAX_ATTEMPTS`） */
  attempts: number;
  /** 最终失败原因（passed = false 时必有） */
  reason?: string;
}

/**
 * AI 个性化专属卡（表结构见 docs/schema.sql 第 308-325 行）
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.3 工程约束
 *   - 同一邀请同一议题只生成一次，结果落库缓存 → 由 `uk_owner_scope_topic` 唯一约束兜底
 *   - 生成后过敏感词与 P7 禁词校验才展示；连续失败降级为通用版并记录
 *   - 生成行为记入审计（viewer / 时间 / prompt 版本）→ requesterUid + promptVersion + generatedAt
 *
 * ⚠️ `ownerUid` 不可省（ADR-008 决策 5）：
 *   单人版专属卡没有邀请，若沿用 `(invite_id, topic_id)` 作缓存键并让 invite_id = 0，
 *   **全站所有单人用户会在同一议题上共用同一行** —— 后生成者覆盖前者，用户会看到别人的专属建议。
 *   故缓存归属独立成列：双人版取**发起方 uid**（保证同一邀请只生成一次，双方共享同一张卡），
 *   单人版取**本人 uid**、invite_id = 0。
 *
 * 降级形态（ADR-007 决策 4）：无已完成邀请时用单人版 prompt（`premium-v1-solo`），
 * 只注入本人数据，状态仍为 ready —— 这是「有内容可看」，不是失败。
 */
@Entity('exclusive_card')
export class ExclusiveCardEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /**
   * 缓存归属（ADR-008 决策 5）
   * 双人版 = 邀请发起方 uid（同一邀请只生成一次，双方共享）；单人版 = 本人 uid
   */
  @Column({ name: 'owner_uid', type: 'bigint', unsigned: true })
  ownerUid: number;

  /** 关联邀请；单人版专属卡为 0（无邀请时的降级形态） */
  @Column({ name: 'invite_id', type: 'bigint', unsigned: true })
  inviteId: number;

  @Column({ name: 'topic_id', type: 'bigint', unsigned: true })
  topicId: number;

  /** 触发生成者（审计用） */
  @Column({ name: 'requester_uid', type: 'bigint', unsigned: true })
  requesterUid: number;

  /** 生成的专属建议（180-250 字）；pending / rejected 时为 null */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** pending / ready / degraded / rejected */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /** prompt 模板版本（premium-v1-duo / premium-v1-solo） */
  @Column({ name: 'prompt_version', type: 'varchar', length: 16 })
  promptVersion: string;

  /** 实际使用的模型（未配置时 null） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ name: 'check_result', type: 'json', nullable: true })
  checkResult: ExclusiveCardCheckResult | null;

  @Column({ name: 'generated_at', type: 'datetime', nullable: true })
  generatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
