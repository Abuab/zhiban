import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PRODUCT_STATUS_OFF,
  PRODUCT_STATUS_ON,
  COUPON_STATUS_EXPIRED,
  COUPON_STATUS_UNUSED,
  COUPON_STATUS_USED,
  ORDER_STATUS_CLOSED,
  ORDER_STATUS_CREATED,
  ORDER_STATUS_PAID,
  ORDER_STATUS_PAYING,
  ORDER_STATUS_REFUNDED,
  ORDER_STATUS_REFUNDING,
} from '../../payment/payment.constants.js';

/** 后台分页查询公共字段（各域 DTO 复用；默认 1 / 20，上限 100） */
export class AdminPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** 后台商品列表查询（GET /api/admin/products） */
export class QueryAdminProductDto extends AdminPageQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([PRODUCT_STATUS_ON, PRODUCT_STATUS_OFF])
  status?: string;

  /** 按编码或名称模糊搜索 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

/**
 * 后台商品编辑（PUT /api/admin/products/:code）
 *
 * 刻意**不接收 code**：`topic_single:<topicCode>` 的编码即权益语义，
 * 允许改码会让已发放的权益指向一个不存在的商品。
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  /**
   * 单位：元（E4 唯一金额口径由服务端掌握）
   * 传数字或数字字符串均可（enableImplicitConversion 会按声明类型转换）；
   * 「最多两位小数」由服务层用 yuanToFen 往返校验，不在这里用浮点比较
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: '价格必须是数字' })
  @Min(0)
  @Max(999999)
  price?: number;

  @IsOptional()
  @IsString()
  @IsIn([PRODUCT_STATUS_ON, PRODUCT_STATUS_OFF])
  status?: string;

  /** 1 = iOS 端展示购买入口（PRD-005 §4：iOS 虚拟商品默认隐藏） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'iosVisible 只能是 0 或 1' })
  iosVisible?: number;

  /** 权益载荷，结构由服务层严格校验（未知 type 直接拒绝，不做静默丢弃） */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  benefits?: unknown[];
}

/** 后台订单列表查询（GET /api/admin/orders） */
export class QueryAdminOrderDto extends AdminPageQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([
    ORDER_STATUS_CREATED,
    ORDER_STATUS_PAYING,
    ORDER_STATUS_PAID,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_REFUNDING,
    ORDER_STATUS_REFUNDED,
  ])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

/**
 * 后台退款（POST /api/admin/orders/:outTradeNo/refund，E7/E10）
 * 必填退款原因：退款是资金动作，无原因不允许执行（也便于客诉复核）
 */
export class RefundOrderDto {
  @IsString()
  @MaxLength(200)
  reason: string;
}

/** 后台兑换码列表查询（GET /api/admin/coupons） */
export class QueryAdminCouponDto extends AdminPageQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([COUPON_STATUS_UNUSED, COUPON_STATUS_USED, COUPON_STATUS_EXPIRED])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;
}

/** 后台批量生成兑换码（POST /api/admin/coupons/generate，E8） */
export class GenerateCouponDto {
  @IsString()
  @MaxLength(32)
  productCode: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count: number;

  /** 不传则取配置的默认有效期（PAYMENT_COUPON_EXPIRE_DAYS） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expireDays?: number;
}

/**
 * 后台手工补发权益（POST /api/admin/entitlements/grant）
 * 用途：回调漏单经对账确认、或客服已收款但系统未记录时的人工兜底（E1）
 */
export class GrantEntitlementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId: number;

  @IsString()
  @MaxLength(32)
  productCode: string;

  /** 补发依据（如客服工单号 / 微信支付单号），最长 64 位以匹配 entitlement.source_ref 列宽 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceRef?: string;
}

/** 后台按用户查权益（GET /api/admin/entitlements） */
export class QueryAdminEntitlementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId: number;
}
