import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AdminUser, AppRequest } from '../../common/types/request-context.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { buildAdminRequestMeta } from './admin-request-meta.util.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { QueryAdminProductDto, UpdateProductDto } from './dto/admin-payment.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';
import { ProductService } from '../payment/product.service.js';
import { ProductEntity } from '../payment/entities/product.entity.js';

/** 后台商品视图（含已下架；端上接口不下发 benefitsJson 的原始结构以外的内部字段） */
interface AdminProductItem {
  id: number;
  code: string;
  name: string;
  price: number;
  status: string;
  iosVisible: number;
  benefits: unknown;
  updatedAt: string;
}

interface AdminProductListResult {
  items: AdminProductItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 后台商品接口（模块 6 后台切片，接口契约见 docs/api.md §16）
 * 实际路径：/api/admin/products*
 *
 * ⚠️ VERSION_NEUTRAL 的理由同 AdminAuthController：避免被 defaultVersion='1' 加成 /api/v1/admin/**（会整站静默 404）。
 * ⚠️ @Public() 与 @UseGuards(AdminIpGuard, AdminAuthGuard) 必须成对出现：只标 @Public() 是 fail-open。
 *
 * 能力边界：
 *   - 只提供「列表 + 编辑既有商品」，**不支持新增/删除商品**
 *     （商品由种子脚本按 `topic.constants.ts` 生成，运营误删会让已发放权益指向空商品）
 *   - code 不可改（见 UpdateProductDto 注释）
 */
@Public()
@UseGuards(AdminIpGuard, AdminAuthGuard)
@Controller({ path: 'admin/products', version: VERSION_NEUTRAL })
export class AdminProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly adminPaymentService: AdminPaymentService,
  ) {}

  /** 商品分页列表（含已下架） */
  @Get()
  async list(@Query() query: QueryAdminProductDto): Promise<AdminProductListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { rows, total } = await this.productService.listForAdmin({
      status: query.status,
      keyword: query.keyword,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items: rows.map((row) => toItem(row)), total, page, pageSize };
  }

  /** 编辑商品（价格 / 名称 / 状态 / iOS 可见性 / 权益载荷），变更写 audit_log */
  @Put(':code')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('code') code: string,
    @Body() dto: UpdateProductDto,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: AppRequest,
  ): Promise<AdminProductItem> {
    const updated = await this.adminPaymentService.updateProduct(
      code,
      dto,
      admin,
      buildAdminRequestMeta(request),
    );
    return toItem(updated);
  }
}

function toItem(product: ProductEntity): AdminProductItem {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    price: product.price,
    status: product.status,
    iosVisible: product.iosVisible,
    benefits: product.benefitsJson ?? [],
    updatedAt: product.updatedAt.toISOString(),
  };
}
