import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 量表维度（表结构见 docs/schema.sql 第 114-127 行）
 * 规格依据：
 *   - 8 个计分维度 + 底线题组（BASELINE），顺序由 order_no 决定（规则 5/6）
 *   - B7：敏感维度（仅维度 8 亲密关系）需前置单独同意，落 is_sensitive
 * 唯一键：uk_version_code(scale_version_id, code)
 */
@Entity('scale_dimension')
export class ScaleDimensionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 所属版本（scale_version.id） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 维度编码，如 FINANCE / HOUSING / INTIMACY；底线题组为 BASELINE */
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 维度名，如「财务观与婚俗财务」 */
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** 卷内顺序（从 1 开始） */
  @Column({ name: 'order_no', type: 'int', unsigned: true, default: 0 })
  orderNo: number;

  /** 敏感维度（前置单独同意 B7）：1 是 / 0 否 */
  @Column({ name: 'is_sensitive', type: 'tinyint', default: 0 })
  isSensitive: number;

  /** 是否参与维度分（规则 6：底线题组为 0）：1 是 / 0 否 */
  @Column({ name: 'is_scored', type: 'tinyint', default: 1 })
  isScored: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
