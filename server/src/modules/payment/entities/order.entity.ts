import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProductBenefit } from '../payment.types.js';
import { decimalTransformer } from './decimal.transformer.js';

/** 下单时的商品快照（E6：运营改价不影响历史订单；也用于退款时核对金额） */
export interface OrderProductSnapshot {
  code: string;
  name: string;
  price: number;
  benefits: ProductBenefit[];
}

/**
 * 订单表（表结构见 docs/schema.sql 第 449-469 行）
 *
 * 规格依据：
 *   - PRD-005 §2 入账流程（预下单生成 out_trade_no → 支付 → 回调 → 幂等 → 发权益）
 *   - 边界总表 E2（out_trade_no 幂等键）/ E3（30 分钟保留）/ E4（金额以后端为准）
 *     / E6（商品快照）/ E9（同用户同商品未完成订单复用）/ E10（退款收回权益）
 *
 * ⚠️ 幂等键 `out_trade_no` 有唯一索引 —— 并发下单时靠数据库唯一约束兜底，
 *    不能只靠应用层「先查后插」（两个请求可能同时查不到）。
 */
@Entity('order')
export class OrderEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 商户订单号（幂等键 E2） */
  @Column({ name: 'out_trade_no', type: 'varchar', length: 64 })
  outTradeNo: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ name: 'product_id', type: 'bigint', unsigned: true })
  productId: number;

  /** 下单时商品快照（E6） */
  @Column({ name: 'product_snapshot', type: 'json' })
  productSnapshot: OrderProductSnapshot;

  /** 单位：元；**下单时从 product 表读取，绝不采信请求体金额**（E4） */
  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: decimalTransformer })
  amount: number;

  /** created / paying / paid / closed / refunding / refunded */
  @Column({ type: 'varchar', length: 24, default: 'created' })
  status: string;

  @Column({ name: 'prepay_id', type: 'varchar', length: 64, nullable: true })
  prepayId: string | null;

  /** 微信支付单号（对账与客诉排查用） */
  @Column({ name: 'transaction_id', type: 'varchar', length: 64, nullable: true })
  transactionId: string | null;

  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt: Date | null;

  /** 支付截止时间（E3：下单 + 30 分钟） */
  @Column({ name: 'expire_at', type: 'datetime', nullable: true })
  expireAt: Date | null;

  @Column({ name: 'refunded_at', type: 'datetime', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
