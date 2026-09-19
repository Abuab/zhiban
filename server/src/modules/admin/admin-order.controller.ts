import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import type { OrderEntity } from '../payment/entities/order.entity.js';
import { OrderService } from '../payment/order.service.js';
import type { OrderDetailView } from '../payment/payment.types.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { QueryAdminOrderDto, RefundOrderDto } from './dto/admin-payment.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/** 后台订单视图（含 userId，便于客服按用户核对；端上接口不下发他人信息） */
interface AdminOrderItem {
  id: number;
  outTradeNo: string;
  userId: number;
  productCode: string;
  productName: string;
  amount: number;
  status: string;
  transactionId: string | null;
  paidAt: string | null;
  expireAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

interface AdminOrderListResult {
  items: AdminOrderItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 后台订单接口（模块 6 后台切片，接口契约见 docs/api.md §16）
 * 实际路径：/api/admin/orders*
 *
 * ⚠️ VERSION_NEUTRAL + @Public() 与守卫成对出现，理由同 AdminProductController。
 *
 * 能力边界（涉钱自查：后台不得成为伪造入账通道）：
 *   - **没有**「直接改订单状态」的接口。补单只能走 `restore`（网关查单结果入账），
 *     它复用 C 端的 `OrderService.recover`，金额比对与幂等与端上完全一致。
 *   - 退款是**不可逆资金动作**：网关退款成功后才置 refunded 并收回权益（E10）；
 *     已退款订单重复调用直接返回当前状态（幂等），不会重复打款。
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/orders', version: VERSION_NEUTRAL })
export class AdminOrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly adminPaymentService: AdminPaymentService,
  ) {}

  /** 订单分页列表（可按状态 / 用户筛选） */
  @Get()
  async list(@Query() query: QueryAdminOrderDto): Promise<AdminOrderListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { rows, total } = await this.orderService.listForAdmin({
      status: query.status,
      userId: query.userId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items: rows.map((row) => toItem(row)), total, page, pageSize };
  }

  /** 单笔订单详情 */
  @Get(':outTradeNo')
  async detail(@Param('outTradeNo') outTradeNo: string): Promise<AdminOrderItem> {
    const order = await this.orderService.findByOutTradeNo(outTradeNo);
    if (!order) throw new BusinessException(ErrorCode.ORDER_NOT_FOUND, undefined, HttpStatus.NOT_FOUND);
    return toItem(order);
  }

  /**
   * 补单（E1）：按订单号去网关查单，查得成功则入账并发权益
   * 幂等：已支付订单直接返回当前状态（`recovered = false`）。
   */
  @Post(':outTradeNo/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('outTradeNo') outTradeNo: string,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<OrderDetailView> {
    return this.adminPaymentService.restoreOrder(outTradeNo, admin, buildAdminRequestMeta(request));
  }

  /** 退款（E7）：网关退款成功 → 订单置已退款 + 收回权益，同一事务（E10） */
  @Post(':outTradeNo/refund')
  @HttpCode(HttpStatus.OK)
  refund(
    @Param('outTradeNo') outTradeNo: string,
    @Body() dto: RefundOrderDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<OrderDetailView> {
    return this.adminPaymentService.refundOrder(
      outTradeNo,
      dto.reason,
      admin,
      buildAdminRequestMeta(request),
    );
  }
}

function toItem(order: OrderEntity): AdminOrderItem {
  return {
    id: order.id,
    outTradeNo: order.outTradeNo,
    userId: order.userId,
    productCode: order.productSnapshot?.code ?? '',
    productName: order.productSnapshot?.name ?? '',
    amount: order.amount,
    status: order.status,
    transactionId: order.transactionId,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    expireAt: order.expireAt ? order.expireAt.toISOString() : null,
    refundedAt: order.refundedAt ? order.refundedAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
  };
}
