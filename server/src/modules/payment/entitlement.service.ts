import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { EntitlementEntity } from './entities/entitlement.entity.js';
import {
  BENEFIT_TYPE_DOUBLE_REPORT,
  BENEFIT_TYPE_TOPIC,
  BENEFIT_TYPE_TOPIC_BUNDLE,
  ENTITLEMENT_SOURCE_MANUAL,
  ENTITLEMENT_STATUS_ACTIVE,
  ENTITLEMENT_STATUS_REVOKED,
} from './payment.constants.js';
import type { EntitlementSource } from './payment.constants.js';
import type { EntitlementSummary, EntitlementView, ProductBenefit } from './payment.types.js';
import { ProductService } from './product.service.js';

/**
 * 权益服务（模块 6）
 *
 * 规格依据：PRD-005 §1「权益挂在 user 上：换设备、换手机、iOS/Android 切换均不影响；
 *   前端任何『已解锁』判断必须来自服务端 GET /entitlements，禁止本地缓存作为判定依据」
 *
 * 设计要点：
 *   - 本表是**唯一可信源**；读取一律直查库（不缓存），保证「付款后立刻解锁」不出现陈旧窗口
 *   - 发放必须在**调用方事务内**完成（`grant(manager, ...)`），与订单状态变更同生共死
 *   - 复用是幂等的：同 user + product 已有 active 权益时直接跳过，
 *     防止重复回调/重复补单刷出多条权益行
 */
@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(EntitlementEntity)
    private readonly repository: Repository<EntitlementEntity>,
    private readonly productService: ProductService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 发放权益（须在事务内调用）
   * @returns 新发放的权益；已存在（幂等命中）时返回 null
   */
  async grant(
    manager: EntityManager,
    params: {
      userId: number;
      productId: number;
      source: EntitlementSource;
      sourceRef: string | null;
      /** 永久权益传 null */
      expireAt?: Date | null;
    },
  ): Promise<EntitlementEntity | null> {
    const repository = manager.getRepository(EntitlementEntity);

    const existing = await repository.findOne({
      where: {
        userId: params.userId,
        productId: params.productId,
        status: ENTITLEMENT_STATUS_ACTIVE,
      },
    });
    if (existing) {
      this.logger.log(
        `权益已存在，跳过重复发放：userId=${params.userId} productId=${params.productId} source=${params.source}`,
        'EntitlementService',
      );
      return null;
    }

    return repository.save(
      repository.create({
        userId: params.userId,
        productId: params.productId,
        source: params.source,
        sourceRef: params.sourceRef,
        status: ENTITLEMENT_STATUS_ACTIVE,
        grantedAt: new Date(),
        expireAt: params.expireAt ?? null,
      }),
    );
  }

  /**
   * 作废（E10：退款回调 → 权益收回）
   * 用 sourceRef（out_trade_no）精确定位，**不物理删除**（留痕；已保存的长图不追回）
   */
  async revokeBySourceRef(manager: EntityManager, sourceRef: string): Promise<number> {
    const result = await manager
      .getRepository(EntitlementEntity)
      .update(
        { sourceRef, status: ENTITLEMENT_STATUS_ACTIVE },
        { status: ENTITLEMENT_STATUS_REVOKED },
      );
    return result.affected ?? 0;
  }

  /** 手工补发/撤销（后台运维，写 audit_log 由调用方负责） */
  async grantManually(params: {
    userId: number;
    productId: number;
    sourceRef: string | null;
  }): Promise<EntitlementEntity | null> {
    return this.repository.manager.transaction((manager) =>
      this.grant(manager, {
        userId: params.userId,
        productId: params.productId,
        source: ENTITLEMENT_SOURCE_MANUAL,
        sourceRef: params.sourceRef,
      }),
    );
  }

  /**
   * 权益汇总（端上渲染解锁态的唯一依据）
   * ⚠️ 过期的权益视为未持有（expireAt 已过），但仍保留在库中便于排查
   */
  async summarize(userId: number): Promise<EntitlementSummary> {
    const rows = await this.repository.find({
      where: { userId, status: ENTITLEMENT_STATUS_ACTIVE },
      order: { id: 'DESC' },
    });

    const now = Date.now();
    const valid = rows.filter((row) => !row.expireAt || row.expireAt.getTime() > now);
    const products = await this.productService.findByIds([
      ...new Set(valid.map((row) => row.productId)),
    ]);

    const items: EntitlementView[] = [];
    const topics = new Set<string>();
    let doubleReport = false;
    let topicBundle = false;

    for (const row of valid) {
      const product = products.get(row.productId);
      if (!product) {
        // 商品被物理删除属运营误操作；权益行仍在，告警但不阻断其他权益
        this.logger.warn(
          `权益引用的商品不存在：entitlementId=${row.id} productId=${row.productId}`,
          'EntitlementService',
        );
        continue;
      }

      const benefits: ProductBenefit[] = ProductService.parseBenefits(product);
      items.push({
        id: row.id,
        productCode: product.code,
        source: row.source,
        grantedAt: row.grantedAt.toISOString(),
        expireAt: row.expireAt ? row.expireAt.toISOString() : null,
        benefits,
      });

      for (const benefit of benefits) {
        if (benefit.type === BENEFIT_TYPE_DOUBLE_REPORT) doubleReport = true;
        if (benefit.type === BENEFIT_TYPE_TOPIC) topics.add(benefit.topicCode);
        if (benefit.type === BENEFIT_TYPE_TOPIC_BUNDLE) {
          topicBundle = true;
          benefit.topicCodes.forEach((code) => topics.add(code));
        }
      }
    }

    return { doubleReport, topics: [...topics], topicBundle, items };
  }

  /** 是否持有某议题（议题包详情的二次校验，防「仅靠前端传参解锁」） */
  async hasTopic(userId: number, topicCode: string): Promise<boolean> {
    const summary = await this.summarize(userId);
    return summary.topics.includes(topicCode);
  }

  /** 批量取「已持有议题集合」（议题列表页一次判完，避免逐条查询） */
  async topicSet(userId: number): Promise<Set<string>> {
    const summary = await this.summarize(userId);
    return new Set(summary.topics);
  }

  /** 是否存在某来源的权益（回调幂等排查用） */
  async existsBySourceRef(sourceRef: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { sourceRef, status: ENTITLEMENT_STATUS_ACTIVE },
    });
    return count > 0;
  }

  /** 按用户批量取权益（后台用户详情用） */
  async listByUserId(userId: number): Promise<EntitlementEntity[]> {
    return this.repository.find({ where: { userId }, order: { id: 'DESC' } });
  }

  /** 按 id 集合取权益（后台按 user 聚合时使用） */
  async findByIds(ids: number[]): Promise<EntitlementEntity[]> {
    if (ids.length === 0) return [];
    return this.repository.find({ where: { id: In(ids) } });
  }
}
