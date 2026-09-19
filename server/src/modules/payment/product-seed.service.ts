import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { ProductEntity } from './entities/product.entity.js';
import type { ProductSeed } from './data/product-seed.data.js';
import { PRODUCT_STATUS_ON } from './payment.constants.js';

/**
 * 商品种子导入服务（模块 6）
 * 职责：把商品清单（纯数据）幂等写入 `product` 表
 *
 * 幂等策略（对应 docs/schema.sql 的 `uk_code`）：
 *   - 按 `code` 判定；已存在且未 `force` 时**整行跳过**（不动运营改过的价格/名称）
 *   - `force` 时覆盖回种子值（用于「种子改了要同步到环境」的场景）
 *
 * 为什么默认不覆盖已存在的行：`price` / `ios_visible` / `status` 都是**运营可在后台改的**
 *   （宪法 P5），若每次启动或每次跑种子都覆盖，运营的改动会被静默回滚。
 */
@Injectable()
export class ProductSeedService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: AppLogger,
  ) {}

  async seed(
    seeds: readonly ProductSeed[],
    options: { force: boolean },
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const result = { created: 0, updated: 0, skipped: 0 };

    await this.dataSource.transaction(async (manager) => {
      const target = manager.getRepository(ProductEntity);

      for (const seed of seeds) {
        const existing = await target.findOne({ where: { code: seed.code } });

        if (!existing) {
          await target.save(
            target.create({
              code: seed.code,
              name: seed.name,
              price: seed.price,
              benefitsJson: seed.benefits,
              iosVisible: seed.iosVisible ? 1 : 0,
              status: PRODUCT_STATUS_ON,
            }),
          );
          result.created += 1;
          continue;
        }

        if (!options.force) {
          result.skipped += 1;
          continue;
        }

        await target.update(
          { id: existing.id },
          {
            name: seed.name,
            price: seed.price,
            benefitsJson: seed.benefits,
            iosVisible: seed.iosVisible ? 1 : 0,
            status: PRODUCT_STATUS_ON,
          },
        );
        result.updated += 1;
      }
    });

    this.logger.log(
      `商品种子导入完成：新增 ${result.created} / 覆盖 ${result.updated} / 跳过 ${result.skipped}`,
      'ProductSeedService',
    );
    return result;
  }
}
