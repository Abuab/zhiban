import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { CouponService } from './coupon.service.js';
import { CreateOrderDto, OutTradeNoParamDto, RedeemCouponDto } from './dto/payment.dto.js';
import { EntitlementService } from './entitlement.service.js';
import { OrderService } from './order.service.js';
import { ProductService } from './product.service.js';
import type {
  CreateOrderResult,
  EntitlementSummary,
  OrderDetailView,
  ProductView,
  RedeemCouponResult,
} from './payment.types.js';

/**
 * 商品与权益接口（模块 6，接口契约见 docs/api.md §14）
 * 全局前缀 /api + URI 版本 v1 → 实际路径 /api/v1/*
 *
 * 鉴权：全部需要登录态（AuthGuard 全局生效）。理由（PRD-005 §1）：
 *   权益是**挂在 user 上**的，端上任何「已解锁」判断都必须来自服务端本组接口，
 *   不允许出现「未登录也能拿到解锁态」的旁路。
 *
 * 越权：`/orders/:outTradeNo` 一律带 `userId` 过滤，他人订单与不存在的订单返回同一结果
 *   （不区分二者，避免用订单号探测他人交易）。
 */
@Controller()
export class PaymentCatalogController {
  constructor(
    private readonly productService: ProductService,
    private readonly entitlementService: EntitlementService,
    private readonly couponService: CouponService,
  ) {}

  /**
   * 在售商品列表（端上定价页）
   * `iosVisible` 由端上按平台判断是否展示购买入口（PRD-005 §4：iOS 隐藏虚拟商品购买）
   */
  @Get('products')
  listProducts(): Promise<ProductView[]> {
    return this.productService.listOnSale();
  }

  /**
   * 我的权益汇总（端上渲染解锁态的**唯一依据**）
   *
   * ⚠️ PRD-005 §1：本接口**不做缓存**（直查库），否则会出现「付款后仍显示未解锁」的陈旧窗口。
   */
  @Get('entitlements')
  getEntitlements(@CurrentUser('id') userId: number): Promise<EntitlementSummary> {
    return this.entitlementService.summarize(userId);
  }

  /**
   * 兑换码核销（PRD-005 §4：iOS 过渡期由客服会话发放）
   * 一次性 + 7 天有效（E8）；并发兑换同一码由单条 UPDATE 原子抢占（见 CouponService）
   */
  @Post('coupons/redeem')
  @HttpCode(HttpStatus.OK)
  redeemCoupon(
    @CurrentUser('id') userId: number,
    @Body() dto: RedeemCouponDto,
  ): Promise<RedeemCouponResult> {
    return this.couponService.redeem(userId, dto.code);
  }
}

/**
 * 订单接口（模块 6，接口契约见 docs/api.md §14）
 *
 * ⚠️ 路由顺序：`mine` 必须声明在 `:outTradeNo` 之前，否则会被当成订单号匹配。
 * ⚠️ 局部更新一律用 PUT 而非 PATCH：微信小程序 `wx.request` 的 method 合法值不含 PATCH。
 */
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * 下单（PRD-005 §2 预下单）
   *
   * 幂等（E9）：同用户同商品存在未完成且未过期的订单时**复用**，不重复建单。
   * 金额（E4）：**完全以库中 `product.price` 为准**，请求体不接收金额字段。
   * `settled = true` 表示无需支付动作（P1 免费模式：下单即到账，端上直接刷新权益）。
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateOrderDto,
  ): Promise<CreateOrderResult> {
    return this.orderService.create(userId, dto.productCode);
  }

  /**
   * 我的订单（端上「订单记录」；按时间倒序）
   * P1 免费期订单金额恒为 0，仍保留该页以承载「我解锁了什么」的凭据语义。
   */
  @Get('mine')
  listMine(@CurrentUser('id') userId: number): Promise<OrderDetailView[]> {
    return this.orderService.listMine(userId);
  }

  /**
   * 恢复购买（E1：漏单兜底）
   *
   * 取该用户最近一笔未完成订单去网关查单，查得成功则补入账（`recovered = true`）。
   * 免费/mock 网关不支持主动查单，此时只返回本地状态 —— **绝不伪造「已支付」**。
   */
  @Post('restore-purchase')
  @HttpCode(HttpStatus.OK)
  restorePurchase(@CurrentUser('id') userId: number): Promise<OrderDetailView | null> {
    return this.orderService.recoverLatest(userId);
  }

  /**
   * 单笔订单详情（端上支付后轮询用）
   *
   * ⚠️ 这是**纯读**接口：不触发网关查单，因此不会因为一次 GET 就改变订单状态。
   *   需要「把漏掉的成功支付补回来」时走上面的 `POST orders/restore-purchase`。
   * 非本人订单与不存在的订单返回同一结果（ORDER_NOT_FOUND），避免订单号枚举 oracle。
   */
  @Get(':outTradeNo')
  detail(
    @CurrentUser('id') userId: number,
    @Param() params: OutTradeNoParamDto,
  ): Promise<OrderDetailView> {
    return this.orderService.detail(userId, params.outTradeNo);
  }
}
