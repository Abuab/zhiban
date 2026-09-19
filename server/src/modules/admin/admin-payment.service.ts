import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import { CouponService } from '../payment/coupon.service.js';
import { EntitlementService } from '../payment/entitlement.service.js';
import { OrderService } from '../payment/order.service.js';
import {
  BENEFIT_TYPE_DOUBLE_REPORT,
  BENEFIT_TYPE_TOPIC,
  BENEFIT_TYPE_TOPIC_BUNDLE,
} from '../payment/payment.constants.js';
import { fenToYuan, yuanToFen } from '../payment/payment.money.js';
import type { EntitlementEntity } from '../payment/entities/entitlement.entity.js';
import type { ProductEntity } from '../payment/entities/product.entity.js';
import type { OrderDetailView, ProductBenefit } from '../payment/payment.types.js';
import { ProductService } from '../payment/product.service.js';
import type { AdminRequestMeta } from './admin.types.js';
import type {
  GenerateCouponDto,
  GrantEntitlementDto,
  UpdateProductDto,
} from './dto/admin-payment.dto.js';

/**
 * 后台支付域写操作（模块 6 后台切片，ADR-007）
 *
 * 为什么写操作集中在 admin 模块而不是 payment 模块：
 *   审计留痕（AuditLogService）与来源信息（AdminRequestMeta）属后台域职责，
 *   payment 域只提供「资金与权益的原子操作」，不感知后台身份。
 *
 * 规格依据：
 *   - 《配置项注册表》商品域：价格 / 名称 / 权益 / iOS 可见性后台可配（宪法 P5）
 *   - 边界总表 E1（漏单对账后人工补单）/ E7（退款）/ E8（兑换码 7 天）/ E10（退款收回权益）
 *
 * 安全自查（「恶意用户 / 误操作会怎么造成损失」）：
 *   1. **改商品编码**：接口不接收 code，从入参层杜绝「编码被改 → 已发权益指向空商品」
 *   2. **金额精度**：价格用 `yuanToFen` 往返校验，拒掉 19.999 这类会在网关侧被四舍五入的输入
 *   3. **权益载荷静默丢弃**：端上解析器（ProductService.parseBenefits）对未知 type 是「跳过」，
 *      若后台也用同一宽松解析，运营写错一个 type 会**静默变成空权益**。故后台用严格校验，未知 type 直接 400。
 *   4. **退款重复执行**：OrderService.refund 对已退款订单直接返回（幂等），不会重复打款
 *   5. **补单**：仅走网关查单结果，不提供「直接把订单改成已支付」的入口，避免后台成为伪造入账通道
 */
@Injectable()
export class AdminPaymentService {
  constructor(
    private readonly productService: ProductService,
    private readonly couponService: CouponService,
    private readonly orderService: OrderService,
    private readonly entitlementService: EntitlementService,
    private readonly auditLog: AuditLogService,
    private readonly logger: AppLogger,
  ) {}

  /** 编辑商品（名称 / 价格 / 状态 / iOS 可见性 / 权益载荷） */
  async updateProduct(
    code: string,
    dto: UpdateProductDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<ProductEntity> {
    const patch: Parameters<ProductService['updateForAdmin']>[1] = {};

    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.price !== undefined) patch.price = this.normalizePrice(dto.price);
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.iosVisible !== undefined) patch.iosVisible = dto.iosVisible;
    if (dto.benefits !== undefined) patch.benefitsJson = this.normalizeBenefits(dto.benefits);

    if (Object.keys(patch).length === 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有需要更新的字段');
    }

    const { before, after } = await this.productService.updateForAdmin(code, patch);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.PRODUCT_UPDATE,
      targetType: 'product',
      targetId: code,
      detail: {
        before,
        after: {
          name: after.name,
          price: after.price,
          status: after.status,
          iosVisible: after.iosVisible,
          benefits: after.benefitsJson,
        },
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return after;
  }

  /** 批量生成兑换码（E8：一次性 + 默认 7 天） */
  async generateCoupons(
    dto: GenerateCouponDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<{ codes: string[]; count: number }> {
    const codes = await this.couponService.generate({
      productCode: dto.productCode,
      count: dto.count,
      expireDays: dto.expireDays,
      operator: `admin:${admin.id}`,
    });

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.COUPON_GENERATE,
      targetType: 'coupon',
      targetId: dto.productCode,
      detail: { count: codes.length, expireDays: dto.expireDays ?? null },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { codes, count: codes.length };
  }

  /**
   * 手工补发权益（E1 漏单兜底）
   * ⚠️ 不提供「手工撤销权益」以外的入口：撤销只在退款流程里做（E10），
   *    避免后台出现两条互相矛盾的权益变更路径。
   */
  async grantEntitlement(
    dto: GrantEntitlementDto,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<{ granted: boolean; entitlementId: number | null }> {
    const product = await this.productService.findByCode(dto.productCode);
    if (!product) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '商品不存在');
    }

    const granted: EntitlementEntity | null = await this.entitlementService.grantManually({
      userId: dto.userId,
      productId: product.id,
      sourceRef: dto.sourceRef ?? `admin:${admin.id}`,
    });

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.ENTITLEMENT_GRANT,
      targetType: 'entitlement',
      targetId: dto.sourceRef ?? `admin:${admin.id}`,
      detail: {
        userId: dto.userId,
        productCode: dto.productCode,
        // 幂等命中（该用户已持有）时 granted = false，如实留痕，便于排查「补发了但没变化」
        granted: granted !== null,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { granted: granted !== null, entitlementId: granted?.id ?? null };
  }

  /**
   * 退款（E7 / E10）
   * `OrderService.refund` 内部保证：网关退款成功后才在同一事务内置已退款 + 收回权益。
   */
  async refundOrder(
    outTradeNo: string,
    reason: string,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<OrderDetailView> {
    const detail = await this.orderService.refund(outTradeNo, reason);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.ORDER_REFUND,
      targetType: 'order',
      targetId: outTradeNo,
      detail: { reason, amount: detail.amount, status: detail.status },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return detail;
  }

  /**
   * 补单（E1）：按订单号去网关查单，查得成功则入账
   * 复用 C 端的 `recover`，保证「端上恢复购买」与「后台补单」走同一套入账逻辑（含金额比对与幂等）。
   */
  async restoreOrder(
    outTradeNo: string,
    admin: AdminUser,
    meta: AdminRequestMeta,
  ): Promise<OrderDetailView> {
    const order = await this.orderService.findByOutTradeNo(outTradeNo);
    if (!order) {
      throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, '订单不存在');
    }

    const detail = await this.orderService.recover(order.userId, outTradeNo);

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.ORDER_RESTORE,
      targetType: 'order',
      targetId: outTradeNo,
      detail: { userId: order.userId, status: detail.status, recovered: detail.recovered },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return detail;
  }

  // ---------------------------------------------------------------- 内部校验

  /** 价格归一（元，最多两位小数）：用 yuanToFen 往返比对，避免浮点直接比较 */
  private normalizePrice(price: number): number {
    const normalized = fenToYuan(yuanToFen(price));
    if (normalized !== price) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '价格最多两位小数');
    }
    return normalized;
  }

  /**
   * 严格校验权益载荷（与端上解析器不同：这里**拒绝**未知结构，不静默丢弃）
   * @throws 400 参数不合法（带具体第几项出错，便于运营自纠）
   */
  private normalizeBenefits(raw: unknown[]): ProductBenefit[] {
    const result: ProductBenefit[] = [];

    raw.forEach((item, index) => {
      const position = `第 ${index + 1} 项`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}必须是对象`);
      }
      const record = item as Record<string, unknown>;

      if (record.type === BENEFIT_TYPE_DOUBLE_REPORT) {
        result.push({ type: BENEFIT_TYPE_DOUBLE_REPORT });
        return;
      }

      if (record.type === BENEFIT_TYPE_TOPIC) {
        const topicCode = record.topicCode;
        if (typeof topicCode !== 'string' || !topicCode || topicCode.length > 32) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的 topicCode 不合法`);
        }
        result.push({ type: BENEFIT_TYPE_TOPIC, topicCode });
        return;
      }

      if (record.type === BENEFIT_TYPE_TOPIC_BUNDLE) {
        const topicCodes = record.topicCodes;
        if (
          !Array.isArray(topicCodes) ||
          topicCodes.length === 0 ||
          !topicCodes.every((code) => typeof code === 'string' && code && code.length <= 32)
        ) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, `${position}的 topicCodes 不合法`);
        }
        // 去重：全包列出全部议题时容易手抖重复，重复项会让端上重复渲染
        result.push({ type: BENEFIT_TYPE_TOPIC_BUNDLE, topicCodes: [...new Set(topicCodes as string[])] });
        return;
      }

      this.logger.warn(
        `后台提交了未知权益类型被拒绝：${String(record.type)}`,
        'AdminPaymentService',
      );
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `${position}的权益类型不合法：${String(record.type)}`,
      );
    });

    return result;
  }
}
