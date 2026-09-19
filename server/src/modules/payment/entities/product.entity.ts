import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ProductBenefit } from '../payment.types.js';
import { decimalTransformer } from './decimal.transformer.js';

/**
 * 商品表（表结构见 docs/schema.sql 第 388-400 行）
 *
 * 规格依据：《配置项注册表》商品域（价格、名称、包含权益、iOS 可见性）；
 *   边界总表 E4（金额以后端商品表为准）/ E6（商品快照）/ PRD-005 §4（iOS 隐藏购买入口）
 *
 * P1 说明（ADR-007 决策 1）：宪法 §2.5 定「P1 全免费」，故 P1 全部商品 price = 0，
 *   下单走「免费直发」通道；P2 恢复定价时**只改数据不改代码**（定价 v0.2：8 / 3 / 19.9）。
 */
@Entity('product')
export class ProductEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 商品编码：double_invite / topic_bundle / `topic_single:<topicCode>` */
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** 单位：元；P1 = 0 */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: decimalTransformer })
  price: number;

  /** 包含权益（端上据此渲染「买它得到什么」） */
  @Column({ name: 'benefits_json', type: 'json', nullable: true })
  benefitsJson: ProductBenefit[] | null;

  /** 1 = iOS 端展示购买入口；PRD-005 §4 要求 iOS 虚拟商品隐藏，故默认 0 */
  @Column({ name: 'ios_visible', type: 'tinyint', default: 0 })
  iosVisible: number;

  /** on / off（下架后不再可下单，已购权益不受影响） */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
