import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { TOPICS, TOPIC_STATUS_ON, type TopicMeta } from './topic.constants.js';
import type { TopicSeed } from './data/topic-seed.data.js';
import { TopicCardEntity } from './entities/topic-card.entity.js';
import { TopicEntity } from './entities/topic.entity.js';

/** 议题种子导入结果（分议题行与卡片行分别计数，便于运维判断「是新增了议题还是只加了卡」） */
export interface TopicSeedResult {
  topicsCreated: number;
  topicsUpdated: number;
  topicsSkipped: number;
  cardsCreated: number;
  cardsUpdated: number;
  cardsSkipped: number;
}

/**
 * 议题与卡片种子导入服务（模块 7）
 * 职责：把 8 议题 + 卡片正文（纯数据）幂等写入 `topic` / `topic_card`
 *
 * 幂等策略：
 *   - 议题按 `uk_code` 判定；已存在且未 `force` 时**只跳过议题行本身，卡片仍继续处理**
 *   - 卡片按 `(topic_id, order_no)` 判定（schema 里是普通索引 `idx_topic_order`，非唯一键，
 *     故必须在事务内先查后写；这里用 findOne 而不是 upsert）
 *
 * 为什么已存在的议题仍继续处理卡片：运营改过议题标题（如把「管钱」改成「共同账户」）后，
 *   我们仍要能追加新写的卡片 —— 若整议题跳过，新增卡片就永远进不了环境。
 *
 * 为什么默认不覆盖已存在的行：`title` / `subtitle` / `status` / 卡片正文都是**运营可在后台改的**
 *   （宪法 P5），每次跑种子都覆盖会静默回滚运营的改动。
 *
 * ⚠️ 议题元数据（标题/副标题/排序/挂载维度）唯一真源是 topic.constants.ts 的 TOPICS：
 *   本服务不接受「种子自带议题元数据」，避免 cards 与 meta 两份清单不同步。
 */
@Injectable()
export class TopicSeedService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: AppLogger,
  ) {}

  async seed(seeds: readonly TopicSeed[], options: { force: boolean }): Promise<TopicSeedResult> {
    const metaByCode = new Map<string, TopicMeta>(TOPICS.map((meta) => [meta.code, meta]));
    const result: TopicSeedResult = {
      topicsCreated: 0,
      topicsUpdated: 0,
      topicsSkipped: 0,
      cardsCreated: 0,
      cardsUpdated: 0,
      cardsSkipped: 0,
    };

    await this.dataSource.transaction(async (manager) => {
      const topicRepo = manager.getRepository(TopicEntity);
      const cardRepo = manager.getRepository(TopicCardEntity);

      for (const seed of seeds) {
        const meta = metaByCode.get(seed.code);
        // 种子里的 code 必须在 TOPICS 里有对应元数据，否则就是「卡片指向不存在的议题」，必须立刻炸掉
        if (!meta) {
          throw new Error(`议题种子缺少元数据：${seed.code}（请同步 topic.constants.ts 的 TOPICS）`);
        }

        const existing = await topicRepo.findOne({ where: { code: seed.code } });
        let topicId: number;

        if (!existing) {
          const saved = await topicRepo.save(
            topicRepo.create({
              code: meta.code,
              title: meta.title,
              subtitle: meta.subtitle,
              mountDimensions: meta.mountDimensions,
              orderNo: meta.orderNo,
              status: TOPIC_STATUS_ON,
            }),
          );
          topicId = saved.id;
          result.topicsCreated += 1;
        } else {
          topicId = existing.id;
          if (options.force) {
            await topicRepo.update(
              { id: existing.id },
              {
                title: meta.title,
                subtitle: meta.subtitle,
                mountDimensions: meta.mountDimensions,
                orderNo: meta.orderNo,
                status: TOPIC_STATUS_ON,
              },
            );
            result.topicsUpdated += 1;
          } else {
            result.topicsSkipped += 1;
          }
        }

        for (const card of seed.cards) {
          const fields = {
            topicId,
            orderNo: card.orderNo,
            cardType: card.cardType,
            title: card.title,
            body: card.body,
            copyable: card.copyable ? 1 : 0,
            optionsJson: card.options ?? null,
            status: TOPIC_STATUS_ON,
          };

          const existingCard = await cardRepo.findOne({
            where: { topicId, orderNo: card.orderNo },
          });

          if (!existingCard) {
            await cardRepo.save(cardRepo.create(fields));
            result.cardsCreated += 1;
            continue;
          }

          if (!options.force) {
            result.cardsSkipped += 1;
            continue;
          }

          await cardRepo.update({ id: existingCard.id }, fields);
          result.cardsUpdated += 1;
        }
      }
    });

    this.logger.log(
      `议题种子导入完成：议题 新增 ${result.topicsCreated} / 覆盖 ${result.topicsUpdated} / 跳过 ${result.topicsSkipped}；` +
        `卡片 新增 ${result.cardsCreated} / 覆盖 ${result.cardsUpdated} / 跳过 ${result.cardsSkipped}`,
      'TopicSeedService',
    );
    return result;
  }
}
