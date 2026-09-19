import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { EntitlementSource } from '../payment.constants.js';

/**
 * 权益表（表结构见 docs/schema.sql 第 471-484 行）
 *
 * 规格依据：PRD-005 §1「权益挂在 user（微信 openid 绑定账号）上：换设备、换手机、
 *   iOS/Android 切换均不影响；前端任何『已解锁』判断必须来自服务端 GET /entitlements」
 *
 * 安全约束：
 *   - 本表是**唯一可信源**；端上不缓存判定结果
 *   - 发放一律在事务内与订单状态变更同时完成（避免「付了钱没权益」）
 *   - 退款只把 status 置 revoked，**不物理删除**（E10：留痕，且已保存的长图不追回）
 */
@Entity('entitlement')
export class EntitlementEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  @Column({ name: 'product_id', type: 'bigint', unsigned: true })
  productId: number;

  /** order（购买）/ coupon（兑换码 E8）/ manual（后台补发） */
  @Column({ type: 'varchar', length: 16 })
  source: EntitlementSource;

  /** 来源单号（out_trade_no）或兑换码 */
  @Column({ name: 'source_ref', type: 'varchar', length: 64, nullable: true })
  sourceRef: string | null;

  /** active / revoked（退款收回 E10） */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  @Column({ name: 'granted_at', type: 'datetime' })
  grantedAt: Date;

  /** 永久权益为 null（议题包、双人报告解锁均无到期概念） */
  @Column({ name: 'expire_at', type: 'datetime', nullable: true })
  expireAt: Date | null;
}
