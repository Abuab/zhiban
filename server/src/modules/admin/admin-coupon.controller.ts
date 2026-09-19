import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import { CouponService } from '../payment/coupon.service.js';
import type { CouponEntity } from '../payment/entities/coupon.entity.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { GenerateCouponDto, QueryAdminCouponDto } from './dto/admin-payment.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/** 后台兑换码视图（不暴露 usedBy 的内部 id 之外的任何字段） */
interface AdminCouponItem {
  id: number;
  code: string;
  productId: number;
  productCode: string;
  status: string;
  usedBy: number | null;
  usedAt: string | null;
  expireAt: string;
  createdAt: string;
}

interface AdminCouponListResult {
  items: AdminCouponItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 后台兑换码接口（模块 6 后台切片，接口契约见 docs/api.md §16）
 * 实际路径：/api/admin/coupons*
 *
 * ⚠️ VERSION_NEUTRAL + @Public() 与守卫成对出现，理由同 AdminProductController。
 *
 * 能力边界：
 *   - 支持「批量生成」与「查询」，**不支持编辑/删除已有码**
 *     （码一旦发放给用户，状态只能由用户兑换动作改变；后台改码状态会与用户侧事实冲突）
 *   - 生成**不返回**已存在的码：每次调用都产生新码，重复点击会真的多生成，前端需二次确认
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/coupons', version: VERSION_NEUTRAL })
export class AdminCouponController {
  constructor(
    private readonly couponService: CouponService,
    private readonly adminPaymentService: AdminPaymentService,
  ) {}

  /** 兑换码分页列表 */
  @Get()
  async list(@Query() query: QueryAdminCouponDto): Promise<AdminCouponListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { rows, total, products } = await this.couponService.listForAdmin({
      status: query.status,
      productId: query.productId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map((row) => toItem(row, products.get(row.productId) ?? '')),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 批量生成兑换码（E8：一次性 + 7 天有效）
   * ⚠️ 返回体含明码，仅供客服会话发放；后台页面不得长期留存本地缓存
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  generate(
    @Body() dto: GenerateCouponDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<{ codes: string[]; count: number }> {
    return this.adminPaymentService.generateCoupons(dto, admin, buildAdminRequestMeta(request));
  }
}

function toItem(coupon: CouponEntity, productCode: string): AdminCouponItem {
  return {
    id: coupon.id,
    code: coupon.code,
    productId: coupon.productId,
    productCode,
    status: coupon.status,
    usedBy: coupon.usedBy,
    usedAt: coupon.usedAt ? coupon.usedAt.toISOString() : null,
    expireAt: coupon.expireAt.toISOString(),
    createdAt: coupon.createdAt.toISOString(),
  };
}
