import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 兑换码池（表结构见 docs/schema.sql 第 486-498 行）
 *
 * 规格依据：
 *   - PRD-005 §4 iOS 过渡期：客服会话发放兑换码，兑换 = entitlement(source=coupon)
 *   - 边界总表 E8：码一次性、7 天有效
 *
 * 安全约束（「恶意用户会怎么攻击这里」）：
 *   - 码用 crypto 随机生成（非自增、非可推导），且兑换接口按 IP + openid 双向限流
 *   - 兑换必须**原子占用**：`UPDATE coupon SET status='used' WHERE code=? AND status='unused'`
 *     受影响行数为 0 即视为已被占用/已过期，避免并发兑换同一码
 *   - 过期码在兑换时判 `expire_at`，不依赖定时任务（懒判定兜底）
 */
@Entity('coupon')
export class CouponEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 兑换后发放的权益对应商品 */
  @Column({ name: 'product_id', type: 'bigint', unsigned: true })
  productId: number;

  /** unused / used / expired */
  @Column({ type: 'varchar', length: 16, default: 'unused' })
  status: string;

  @Column({ name: 'used_by', type: 'bigint', unsigned: true, nullable: true })
  usedBy: number | null;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt: Date | null;

  /** 7 天有效（E8） */
  @Column({ name: 'expire_at', type: 'datetime' })
  expireAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
