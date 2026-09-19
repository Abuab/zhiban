import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 锦囊议题（表结构见 docs/schema.sql 第 276-289 行）
 *
 * 规格依据：《锦囊卡片流 v1.0》8 议题；内容下架开关见《配置项注册表》内容域（G3）
 */
@Entity('topic')
export class TopicEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 议题编码（唯一真源见 topic.constants.ts 的 TOPIC_CODES） */
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  /** 一句话钩子 */
  @Column({ type: 'varchar', length: 256, nullable: true })
  subtitle: string | null;

  /**
   * 挂载维度编码数组（ADR-007 附带决策 4）
   * 报告「待沟通区」按维度反查议题包入口，一个议题可挂多维度
   */
  @Column({ name: 'mount_dimensions', type: 'json', nullable: true })
  mountDimensions: string[] | null;

  /** 列表排序（从 0 起） */
  @Column({ name: 'order_no', type: 'int', unsigned: true, default: 0 })
  orderNo: number;

  /** on / off（下架后 C 端列表不展示，已生成内容不追回） */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
