import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { ReportTemplateBlockEntity } from './entities/report-template-block.entity.js';
import { ReportTemplateEntity } from './entities/report-template.entity.js';
import type { ReportTemplateSeed } from './report-seed.types.js';
import { ScaleQueryService } from '../scale/scale-query.service.js';

/** 模板状态：on 启用（导入即启用，未启用的模板不会被渲染读取） */
const STATUS_ON = 'on';

/**
 * 报告模板导入服务（模块 4）
 * 职责：把报告域种子（纯数据）幂等写入 report_template + report_template_block
 *
 * 幂等策略（对应 docs/schema.sql 的 uk_code_version）：
 *   - 模板按 (code, version) 判定；已存在且未 force 时不产生任何写入
 *   - force 重建只删本模板的区块行，不影响其他模板
 * 事务：模板行与区块行的写入在同一事务内，避免「有模板没区块」的半成品
 */
@Injectable()
export class ReportTemplateSeedService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly scaleQueryService: ScaleQueryService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 导入一个报告模板
   * @returns created 本次是否写入；skipped 是否已存在而跳过；blockCount 该模板区块数
   */
  async seedTemplate(
    seed: ReportTemplateSeed,
    options?: { force?: boolean },
  ): Promise<{ created: boolean; skipped: boolean; blockCount: number }> {
    this.assertSeed(seed);
    const force = options?.force === true;

    // 先在事务外解析 scale_version_id：量表不存在属于配置错误，没必要开事务
    const version = await this.scaleQueryService.findVersionByCode(seed.scaleCode, seed.scaleVersion);
    if (!version) {
      throw new Error(
        `报告模板 ${seed.code} 引用的量表版本不存在：${seed.scaleCode} ${seed.scaleVersion}（请先执行 npm run scale:seed）`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const templateRepository = manager.getRepository(ReportTemplateEntity);
      const blockRepository = manager.getRepository(ReportTemplateBlockEntity);

      const existing = await templateRepository.findOne({
        where: { code: seed.code, version: seed.version },
      });

      if (existing && !force) {
        const blockCount = await blockRepository.count({ where: { templateId: existing.id } });
        this.logger.log(
          `报告模板 ${seed.code} ${seed.version} 已存在，跳过导入（现有区块 ${blockCount} 个）；如需重建请显式传 force`,
          'ReportTemplateSeedService',
        );
        return { created: false, skipped: true, blockCount };
      }

      let templateId: number;
      if (existing) {
        // 只删本模板的区块，不影响其他模板
        await blockRepository.delete({ templateId: existing.id });
        await templateRepository.update(
          { id: existing.id },
          {
            scaleVersionId: version.id,
            audience: seed.audience,
            level: seed.level,
            disclaimer: seed.disclaimer,
            status: STATUS_ON,
          },
        );
        templateId = existing.id;
      } else {
        const created = await templateRepository.save(
          templateRepository.create({
            code: seed.code,
            scaleVersionId: version.id,
            audience: seed.audience,
            relationStatus: null,
            level: seed.level,
            disclaimer: seed.disclaimer,
            version: seed.version,
            status: STATUS_ON,
          }),
        );
        templateId = created.id;
      }

      await blockRepository.save(
        seed.blocks.map((block) =>
          blockRepository.create({
            templateId,
            blockKey: block.blockKey,
            orderNo: block.orderNo,
            minChars: block.minChars,
            templateText: block.templateText,
          }),
        ),
      );

      this.logger.log(
        `报告模板 ${seed.code} ${seed.version} 导入完成：区块 ${seed.blocks.length} 个（template_id=${templateId}，量表版本 ${version.id}）`,
        'ReportTemplateSeedService',
      );

      return { created: true, skipped: false, blockCount: seed.blocks.length };
    });
  }

  /** 种子自检：区块键唯一 + 文案非空 + 排序号唯一 */
  private assertSeed(seed: ReportTemplateSeed): void {
    if (seed.blocks.length === 0) {
      throw new Error(`报告模板 ${seed.code} 没有任何区块，拒绝导入`);
    }
    const keys = seed.blocks.map((block) => block.blockKey);
    if (new Set(keys).size !== keys.length) {
      throw new Error(`报告模板 ${seed.code} 的 blockKey 存在重复，拒绝导入`);
    }
    const orderNos = seed.blocks.map((block) => block.orderNo);
    if (new Set(orderNos).size !== orderNos.length) {
      throw new Error(`报告模板 ${seed.code} 的 orderNo 存在重复，渲染顺序不确定，拒绝导入`);
    }
    for (const block of seed.blocks) {
      if (!block.templateText.trim()) {
        throw new Error(`报告模板 ${seed.code} 的区块 ${block.blockKey} 文案为空，拒绝导入`);
      }
    }
  }
}
