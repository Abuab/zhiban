import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 报告模板区块（表结构见 docs/schema.sql 第 371-381 行）
 * 规格依据：
 *   - architecture.md §5「报告域」：block_key 承载「维度解读 / 对话建议 / 待沟通区 / 共识区 / 结尾总结」
 *   - 价值感与内容标准 §一：min_chars 为内容详实度下限
 *   - ADR-004 决策 3：单人简版以**维度编码**为 block_key，另加 INTRO / LOCK_HINT
 * 索引：idx_template_order(template_id, order_no)
 */
@Entity('report_template_block')
export class ReportTemplateBlockEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 所属模板（report_template.id） */
  @Column({ name: 'template_id', type: 'bigint', unsigned: true })
  templateId: number;

  /**
   * 区块键
   * - 单人简版（ADR-004）：维度编码（FINANCE/HOUSING/…/INTIMACY）或 INTRO / LOCK_HINT
   * - 双人完整版（模块 5 待落地）：维度解读 / 对话建议 / 待沟通区 / 共识区 / 结尾总结
   */
  @Column({ name: 'block_key', type: 'varchar', length: 32 })
  blockKey: string;

  @Column({ name: 'order_no', type: 'int', unsigned: true, default: 0 })
  orderNo: number;

  /** 内容详实度下限（字符数）；简版无下限要求，为 null */
  @Column({ name: 'min_chars', type: 'int', unsigned: true, nullable: true })
  minChars: number | null;

  /** 占位符文本，由 engines/report/template.engine.ts 渲染 */
  @Column({ name: 'template_text', type: 'text' })
  templateText: string;
}
