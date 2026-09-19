import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 支付回调日志（表结构见 docs/schema.sql 第 500-511 行）
 *
 * 为什么「先落日志再改单」：回调是外部触发且微信会重复推送，
 *   一旦处理过程中抛异常（DB 抖动、代码 bug），**原始报文是唯一证据**；
 *   先落日志可在事后精确区分「从未收到」与「收到但处理失败」，
 *   这也是人工补单（E1）与伪造回调排查（安全审计）的依据。
 *
 * 留证规则：
 *   - 验签失败的报文同样落库，`verify_result = 0`（安全事件可追溯）
 *   - 命中幂等时 `idempotent_hit = 1`，用于统计微信重复推送频率
 */
@Entity('payment_notify_log')
export class PaymentNotifyLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 解析出的商户订单号（报文损坏时为 null，但原文仍保留） */
  @Column({ name: 'out_trade_no', type: 'varchar', length: 64, nullable: true })
  outTradeNo: string | null;

  /** 原始回调报文（验签与解密都用原始字节，故此处存原文） */
  @Column({ name: 'raw_body', type: 'text' })
  rawBody: string;

  /** 验签结果：1 通过 / 0 失败（伪造回调必为 0） */
  @Column({ name: 'verify_result', type: 'tinyint', default: 0 })
  verifyResult: number;

  /** 是否命中幂等（同一 out_trade_no 重复推送） */
  @Column({ name: 'idempotent_hit', type: 'tinyint', default: 0 })
  idempotentHit: number;

  /** 是否完成权益发放 */
  @Column({ type: 'tinyint', default: 0 })
  processed: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
