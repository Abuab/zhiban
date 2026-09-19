import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { PaymentConfig } from '../../config/configuration.js';
import { ConfigService } from '@nestjs/config';
import { EntitlementService } from './entitlement.service.js';
import { CouponEntity } from './entities/coupon.entity.js';
import {
  COUPON_CODE_ALPHABET,
  COUPON_CODE_LENGTH,
  COUPON_STATUS_EXPIRED,
  COUPON_STATUS_UNUSED,
  COUPON_STATUS_USED,
  ENTITLEMENT_SOURCE_COUPON,
} from './payment.constants.js';
import { ProductService } from './product.service.js';
import { calculateCouponExpireAt } from './payment.money.js';
import type { RedeemCouponResult } from './payment.types.js';

/** 生成兑换码时的最大重试次数（每次重试都重新随机；冲突概率极低，重试只为兜底唯一索引） */
const CODE_GENERATE_MAX_ATTEMPTS = 5;

/** 单次批量生成的码数上限（防一次请求生成过多码把库刷满） */
const MAX_GENERATE_COUNT = 500;

/**
 * 兑换码服务（模块 6）
 *
 * 规格依据：
 *   - PRD-005 §4 iOS 过渡期：客服会话发放兑换码，兑换 = `entitlement(source = 'coupon')`
 *   - 边界总表 E8：码**一次性**、**7 天**有效
 *
 * 安全自查（「恶意用户会怎么攻击这里」）：
 *   1. **并发兑换同一码**：`UPDATE ... WHERE code = ? AND status = 'unused'` 单语句原子占用，
 *      受影响行数为 0 即判定为已被抢走（不依赖「先查后改」，那之间必然存在竞态）
 *   2. **暴力枚举码**：码空间 32^12 ≈ 1.15e18，且接口按 IP 限流；
 *      不存在与已使用返回**不同**错误码是有意为之 —— 「已使用」只有在码真实存在时才可能出现，
 *      而拿到别人已用掉的码本身无价值，故泄露这一点不构成 oracle
 *   3. **重复兑换刷权益**：权益发放自身查重（同 user + product 已有 active 则跳过），
 *      且码在事务内先被置为 used（第二次必然失败）
 *   4. **过期码**：兑换时懒判定 `expire_at`（不依赖定时任务），过期即拒绝
 */
@Injectable()
export class CouponService {
  private readonly couponExpireDays: number;

  constructor(
    @InjectRepository(CouponEntity)
    private readonly repository: Repository<CouponEntity>,
    private readonly entitlementService: EntitlementService,
    private readonly productService: ProductService,
    configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.couponExpireDays = (configService.get<PaymentConfig>('payment') as PaymentConfig)
      .couponExpireDays;
  }

  /**
   * 兑换（C 端）
   *
   * 顺序刻意是「先判状态 → 再原子占用 → 再发权益」：
   * 占用与发放必须在**同一事务**内，否则「码已用掉但权益没发」会变成无法自证的客诉。
   */
  async redeem(userId: number, rawCode: string): Promise<RedeemCouponResult> {
    const code = rawCode.trim().toUpperCase();
    const coupon = await this.repository.findOne({ where: { code } });
    if (!coupon) throw new BusinessException(ErrorCode.COUPON_INVALID);
    if (coupon.status === COUPON_STATUS_USED) throw new BusinessException(ErrorCode.COUPON_USED);
    if (
      coupon.status === COUPON_STATUS_EXPIRED ||
      (coupon.expireAt && coupon.expireAt.getTime() <= Date.now())
    ) {
      throw new BusinessException(ErrorCode.COUPON_EXPIRED);
    }

    const products = await this.productService.findByIds([coupon.productId]);
    const product = products.get(coupon.productId);
    if (!product) {
      // 商品被物理删除属运营误操作：拒绝兑换并告警，宁可让人工补发也不要发一笔查不到来源的权益
      this.logger.error(
        `兑换码引用的商品不存在：couponId=${coupon.id} productId=${coupon.productId}`,
        undefined,
        'CouponService',
      );
      throw new BusinessException(ErrorCode.COUPON_INVALID);
    }

    const outcome = await this.repository.manager.transaction(async (manager) => {
      const claimed = await this.claim(manager, coupon.id, userId);
      if (!claimed) return { claimed: false as const, grantedAt: new Date() };

      const entitlement = await this.entitlementService.grant(manager, {
        userId,
        productId: coupon.productId,
        source: ENTITLEMENT_SOURCE_COUPON,
        sourceRef: code,
        expireAt: null,
      });
      if (!entitlement) {
        // 该用户已持有同一商品权益：码仍按已消耗处理（码是一次性的），但留下告警便于客服排查
        this.logger.warn(
          `兑换成功但权益已存在（未重复发放）：userId=${userId} code=${code} product=${product.code}`,
          'CouponService',
        );
        return { claimed: true as const, grantedAt: new Date() };
      }
      return { claimed: true as const, grantedAt: entitlement.grantedAt };
    });

    if (!outcome.claimed) {
      // 同一码被并发兑换：抢占失败的一方按「已被使用」答复
      throw new BusinessException(ErrorCode.COUPON_USED);
    }

    this.logger.log(
      `兑换码核销完成：userId=${userId} code=${code} product=${product.code}`,
      'CouponService',
    );
    return {
      productCode: product.code,
      benefits: ProductService.parseBenefits(product),
      grantedAt: outcome.grantedAt.toISOString(),
    };
  }

  /**
   * 批量生成兑换码（后台运维/客服）
   * @returns 生成成功的码（重复冲突会自动重试，最终仍失败则抛错，不返回半截结果）
   */
  async generate(params: {
    productCode: string;
    count: number;
    /** 不传则取配置的默认有效期（PAYMENT_COUPON_EXPIRE_DAYS） */
    expireDays?: number;
    operator: string;
  }): Promise<string[]> {
    const count = Math.min(Math.max(Math.trunc(params.count), 1), MAX_GENERATE_COUNT);
    const product = await this.productService.requireOnSale(params.productCode);
    const expireDays = params.expireDays ?? this.couponExpireDays;
    const expireAt = calculateCouponExpireAt(expireDays, new Date());

    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      codes.push(await this.generateUniqueCode());
    }

    await this.repository.save(
      codes.map((code) =>
        this.repository.create({
          code,
          productId: product.id,
          status: COUPON_STATUS_UNUSED,
          usedBy: null,
          usedAt: null,
          expireAt,
        }),
      ),
    );

    this.logger.log(
      `兑换码生成完成：商品=${product.code} 数量=${codes.length} 有效期至=${expireAt.toISOString()} 操作人=${params.operator}`,
      'CouponService',
    );
    return codes;
  }

  /** 后台：分页查询兑换码 */
  async listForAdmin(params: {
    status?: string;
    productId?: number;
    limit: number;
    offset: number;
  }): Promise<{ rows: CouponEntity[]; total: number; products: Map<number, string> }> {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.productId) where.productId = params.productId;

    const [rows, total] = await this.repository.findAndCount({
      where,
      order: { id: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });

    const products = await this.productService.findByIds([
      ...new Set(rows.map((row) => row.productId)),
    ]);
    return {
      rows,
      total,
      products: new Map([...products].map(([id, product]) => [id, product.code])),
    };
  }

  // ---------------------------------------------------------------- 内部方法

  /**
   * 原子占用：`UPDATE coupon SET status = 'used' ... WHERE id = ? AND status = 'unused'`
   * 受影响行数 1 = 抢到；0 = 已被别人抢走（并发兑换/重复提交）
   */
  private async claim(manager: EntityManager, couponId: number, userId: number): Promise<boolean> {
    const result = await manager
      .getRepository(CouponEntity)
      .createQueryBuilder()
      .update(CouponEntity)
      .set({ status: COUPON_STATUS_USED, usedBy: userId, usedAt: new Date() })
      .where('id = :id AND status = :status', { id: couponId, status: COUPON_STATUS_UNUSED })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** 随机生成一个库中不存在的码（冲突重试上限 CODE_GENERATE_MAX_ATTEMPTS） */
  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < CODE_GENERATE_MAX_ATTEMPTS; attempt += 1) {
      const code = randomCouponCode();
      const exists = await this.repository.exists({ where: { code } });
      if (!exists) return code;
    }
    throw new BusinessException(
      ErrorCode.INTERNAL_ERROR,
      '兑换码生成冲突，请稍后重试',
    );
  }
}

/** 用密码学随机数生成兑换码（`randomInt` 无模偏差，不用 Math.random） */
function randomCouponCode(): string {
  let code = '';
  for (let i = 0; i < COUPON_CODE_LENGTH; i += 1) {
    code += COUPON_CODE_ALPHABET[randomInt(0, COUPON_CODE_ALPHABET.length)];
  }
  return code;
}
