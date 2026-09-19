import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { COUPON_CODE_LENGTH } from '../payment.constants.js';

/** 商品编码在 `product.code` 中为 VARCHAR(32) */
const MAX_PRODUCT_CODE_LENGTH = 32;

/** 门店订单号在 `order.out_trade_no` 中为 VARCHAR(64) */
const MAX_OUT_TRADE_NO_LENGTH = 64;

/**
 * 下单入参（POST /api/v1/orders）
 *
 * ⚠️ **刻意不接收金额字段**（E4）：金额一律由服务端读 `product.price`，
 *   请求体里出现任何金额都只可能是端上展示残留，采信即等于把定价权交给客户端。
 */
export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PRODUCT_CODE_LENGTH)
  productCode: string;
}

/**
 * 兑换码入参（POST /api/v1/coupons/redeem）
 * 长度与字符集固定：码由服务端用 `COUPON_CODE_ALPHABET` 生成（去易混字符），
 * 此处只做**格式前置校验**，是否有效仍由库中状态判定（不泄露「码是否存在」的区别）。
 */
export class RedeemCouponDto {
  @IsString()
  @Matches(new RegExp(`^[A-Z0-9]{${COUPON_CODE_LENGTH}}$`), { message: '兑换码格式不正确' })
  code: string;
}

/** 订单号入参（GET /api/v1/orders/:outTradeNo） */
export class OutTradeNoParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OUT_TRADE_NO_LENGTH)
  outTradeNo: string;
}
