import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 议题阅读进度（表结构见 docs/schema.sql 第 326-336 行）
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.4 —— 每议题包首次进入从头播放，已读进度可续看。
 *
 * 为什么进度存服务端而不是只存本地：
 *   用户换设备（A1：账号跟随 openid）后要能续看；且「已学会」是运营侧的完成度指标。
 *   端上本地缓存只作秒开占位，进入页面后以服务端返回为准。
 */
@Entity('topic_read_progress')
export class TopicReadProgressEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ name: 'topic_id', type: 'bigint', unsigned: true })
  topicId: number;

  /** 续看位置（上次停留的卡序） */
  @Column({ name: 'last_order_no', type: 'int', unsigned: true, default: 0 })
  lastOrderNo: number;

  /** 1 = 已学会打卡 */
  @Column({ type: 'tinyint', default: 0 })
  finished: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
