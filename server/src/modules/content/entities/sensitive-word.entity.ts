import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 敏感词适用范围 */
export type SensitiveWordScope = 'nickname' | 'exclusive_card' | 'all';

/**
 * 本地敏感词兜底表（表结构见 docs/schema.sql）
 * 规格依据：
 *   - 宪法 P5「内容与规则可配置」：词表在库中维护，禁止硬编码
 *   - 边界总表 A6：昵称权威检测以微信内容安全接口为准，此表用于接口不可用时兜底
 */
@Entity('sensitive_word')
export class SensitiveWordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 64 })
  word: string;

  @Column({ type: 'varchar', length: 16, default: 'nickname' })
  scope: SensitiveWordScope;

  /** on / off：运营可临时停用（避免误杀扩散） */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: 'on' | 'off';

  @Column({ type: 'varchar', length: 128, nullable: true })
  remark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
