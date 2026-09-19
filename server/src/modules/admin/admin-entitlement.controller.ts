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
import { EntitlementService } from '../payment/entitlement.service.js';
import type { EntitlementEntity } from '../payment/entities/entitlement.entity.js';
import { ProductService } from '../payment/product.service.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { GrantEntitlementDto, QueryAdminEntitlementDto } from './dto/admin-payment.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/** 后台权益视图 */
interface AdminEntitlementItem {
  id: number;
  userId: number;
  productId: number;
  productCode: string;
  source: string;
  sourceRef: string | null;
  status: string;
  grantedAt: string;
  expireAt: string | null;
}

/**
 * 后台权益接口（模块 6 后台切片，接口契约见 docs/api.md §16）
 * 实际路径：/api/admin/entitlements*
 *
 * ⚠️ VERSION_NEUTRAL + @Public() 与守卫成对出现，理由同 AdminProductController。
 *
 * 能力边界：
 *   - 按 userId 查询 + 手工补发（E1 漏单兜底）
 *   - **不提供手工撤销**：撤销只在退款流程内发生（E10），避免两条互相矛盾的权益变更路径
 *   - 补发是幂等的（同 user + product 已有 active 权益时返回 `granted = false`），
 *     客服重复点击不会刷出多条权益
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/entitlements', version: VERSION_NEUTRAL })
export class AdminEntitlementController {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly productService: ProductService,
    private readonly adminPaymentService: AdminPaymentService,
  ) {}

  /** 按用户查权益（含已作废行，便于核对「退款是否真的收回了权益」） */
  @Get()
  async list(@Query() query: QueryAdminEntitlementDto): Promise<AdminEntitlementItem[]> {
    const rows = await this.entitlementService.listByUserId(query.userId);
    // 一次批量取商品（避免逐行查询），后台表格直接显示商品编码而非裸 id
    const products = await this.productService.findByIds([...new Set(rows.map((row) => row.productId))]);
    return rows.map((row) => toItem(row, products.get(row.productId)?.code ?? ''));
  }

  /** 手工补发权益（E1：对账确认漏单 / 客服已收款但系统无记录） */
  @Post('grant')
  @HttpCode(HttpStatus.OK)
  grant(
    @Body() dto: GrantEntitlementDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<{ granted: boolean; entitlementId: number | null }> {
    return this.adminPaymentService.grantEntitlement(dto, admin, buildAdminRequestMeta(request));
  }
}

function toItem(entitlement: EntitlementEntity, productCode: string): AdminEntitlementItem {
  return {
    id: entitlement.id,
    userId: entitlement.userId,
    productId: entitlement.productId,
    productCode,
    source: entitlement.source,
    sourceRef: entitlement.sourceRef,
    status: entitlement.status,
    grantedAt: entitlement.grantedAt.toISOString(),
    expireAt: entitlement.expireAt ? entitlement.expireAt.toISOString() : null,
  };
}
