import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 量表主表（表结构见 docs/schema.sql 第 88-97 行）
 * 规格依据：
 *   - 宪法 P5「内容与规则可配置」：量表/维度/题目全部落库维护，禁止硬编码题库
 *   - 版本化：同一 code 可并存多个版本（SCALE-PRE-1.0 / 1.1），最新生效版本由 latest_version_id 指向
 * 唯一键：uk_code(code) —— 导入服务按 code 幂等复用，不重复插入
 */
@Entity('scale')
export class ScaleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 量表编码：SCALE-PRE（婚前评估）/ SCALE-16P（16 型人格图谱） */
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  /** 量表名称 */
  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  /** 当前生效版本（scale_version.id） */
  @Column({ name: 'latest_version_id', type: 'bigint', unsigned: true, nullable: true })
  latestVersionId: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
