import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { ProductEntity } from './entities/product.entity.js';
import {
  BENEFIT_TYPE_DOUBLE_REPORT,
  BENEFIT_TYPE_TOPIC,
  BENEFIT_TYPE_TOPIC_BUNDLE,
  PRODUCT_STATUS_ON,
} from './payment.constants.js';
import type { ProductBenefit, ProductView } from './payment.types.js';

/**
 * 商品可变字段快照（后台改动的审计留痕用；不含 id/code/updatedAt 等不可改字段）
 */
export interface ProductSnapshot {
  name: string;
  price: number;
  status: string;
  iosVisible: number;
  benefits: ProductBenefit[] | null;
}

/**
 * 商品服务（模块 6）
 *
 * 规格依据：
 *   - 《配置项注册表》商品域：价格、名称、包含权益、iOS 可见性均为后台可配（宪法 P5）
 *   - 边界总表 E4：**金额一律取自本服务的 product.price**，请求体金额只作展示
 *   - PRD-005 §4：iOS 隐藏购买入口 → 下发 iosVisible，由端上按平台判断
 */
@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
    private readonly logger: AppLogger,
  ) {}

  /** 在售商品列表（端上定价展示用） */
  async listOnSale(): Promise<ProductView[]> {
    const rows = await this.repository.find({
      where: { status: PRODUCT_STATUS_ON },
      order: { id: 'ASC' },
    });
    return rows.map((row) => this.toView(row));
  }

  /** 按编码取商品（含已下架；供对账/后台查看用） */
  findByCode(code: string): Promise<ProductEntity | null> {
    return this.repository.findOne({ where: { code } });
  }

  /**
   * 取下单所需商品：不存在或已下架一律拒绝
   * ⚠️ 下架商品仍可能被端上缓存的旧列表点到，必须服务端拦截
   */
  async requireOnSale(code: string): Promise<ProductEntity> {
    const product = await this.findByCode(code);
    if (!product || product.status !== PRODUCT_STATUS_ON) {
      this.logger.warn(`下单请求命中不可用商品：${code}`, 'ProductService');
      throw new BusinessException(ErrorCode.PRODUCT_UNAVAILABLE);
    }
    return product;
  }

  /** 批量按 id 取商品（权益汇总时补商品信息） */
  async findByIds(ids: number[]): Promise<Map<number, ProductEntity>> {
    if (ids.length === 0) return new Map();
    const rows = await this.repository.find({ where: { id: In(ids) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** 后台：分页取全部商品（含已下架；端上接口只给在售） */
  async listForAdmin(params: {
    status?: string;
    keyword?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: ProductEntity[]; total: number }> {
    const builder = this.repository.createQueryBuilder('product');
    if (params.status) {
      builder.andWhere('product.status = :status', { status: params.status });
    }
    if (params.keyword) {
      builder.andWhere('(product.code LIKE :keyword OR product.name LIKE :keyword)', {
        keyword: `%${params.keyword}%`,
      });
    }
    const [rows, total] = await builder
      .orderBy('product.id', 'ASC')
      .take(params.limit)
      .skip(params.offset)
      .getManyAndCount();
    return { rows, total };
  }

  /**
   * 后台：编辑商品（名称 / 价格 / 状态 / iOS 可见性 / 权益载荷）
   * @returns before 与 after 供审计留痕；商品不存在抛 404
   *
   * ⚠️ 商品编码不可改：`topic_single:<topicCode>` 编码即权益语义，
   *    改码会让已发放权益指向不存在的商品。
   */
  async updateForAdmin(
    code: string,
    patch: Partial<Pick<ProductEntity, 'name' | 'price' | 'status' | 'iosVisible' | 'benefitsJson'>>,
  ): Promise<{ before: ProductSnapshot; after: ProductEntity }> {
    const product = await this.repository.findOne({ where: { code } });
    if (!product) {
      throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, '商品不存在', HttpStatus.NOT_FOUND);
    }

    const before: ProductSnapshot = {
      name: product.name,
      price: product.price,
      status: product.status,
      iosVisible: product.iosVisible,
      benefits: product.benefitsJson,
    };

    if (patch.name !== undefined) product.name = patch.name;
    if (patch.price !== undefined) product.price = patch.price;
    if (patch.status !== undefined) product.status = patch.status;
    if (patch.iosVisible !== undefined) product.iosVisible = patch.iosVisible;
    if (patch.benefitsJson !== undefined) product.benefitsJson = patch.benefitsJson;

    const saved = await this.repository.save(product);
    this.logger.log(
      `商品已更新：code=${code} 名称=${saved.name} 价格=${saved.price} 状态=${saved.status}`,
      'ProductService',
    );
    return { before, after: saved };
  }

  /** 实体 → 端上视图 */
  toView(product: ProductEntity): ProductView {
    return {
      code: product.code,
      name: product.name,
      price: product.price,
      iosVisible: product.iosVisible === 1,
      benefits: ProductService.parseBenefits(product),
    };
  }

  /**
   * 解析权益载荷（防御非法数据）
   * 库里是后台可写的 JSON，出现未知 type 时**跳过并告警**，不让端上拿到无法识别的权益
   */
  static parseBenefits(product: Pick<ProductEntity, 'code' | 'benefitsJson'>): ProductBenefit[] {
    const raw = product.benefitsJson;
    if (!Array.isArray(raw)) return [];

    const result: ProductBenefit[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const type = (item as { type?: unknown }).type;
      if (type === BENEFIT_TYPE_DOUBLE_REPORT) {
        result.push({ type: BENEFIT_TYPE_DOUBLE_REPORT });
        continue;
      }
      if (type === BENEFIT_TYPE_TOPIC) {
        const topicCode = (item as { topicCode?: unknown }).topicCode;
        if (typeof topicCode === 'string' && topicCode) {
          result.push({ type: BENEFIT_TYPE_TOPIC, topicCode });
        }
        continue;
      }
      if (type === BENEFIT_TYPE_TOPIC_BUNDLE) {
        const topicCodes = (item as { topicCodes?: unknown }).topicCodes;
        if (Array.isArray(topicCodes) && topicCodes.every((code) => typeof code === 'string')) {
          result.push({ type: BENEFIT_TYPE_TOPIC_BUNDLE, topicCodes: topicCodes as string[] });
        }
      }
    }
    return result;
  }
}
