import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReportTemplateBlockEntity } from './entities/report-template-block.entity.js';
import { ReportTemplateEntity, type ReportAudience } from './entities/report-template.entity.js';

/** 模板状态：on 启用 / off 停用 */
const STATUS_ON = 'on';

/** 已装载的报告模板（模板行 + 区块，按 order_no 升序） */
export interface LoadedReportTemplate {
  template: ReportTemplateEntity;
  blocks: ReportTemplateBlockEntity[];
}

/**
 * 报告域只读查询服务
 * 规格依据：
 *   - architecture.md §5「报告域」：渲染时读取模板 → 改文案零发版
 *   - D5：历史报告用其生成时的模板版本渲染 → 调用方须传「作答锁定的 scale_version_id」
 */
@Injectable()
export class ReportTemplateService {
  constructor(
    @InjectRepository(ReportTemplateEntity)
    private readonly templateRepository: Repository<ReportTemplateEntity>,
    @InjectRepository(ReportTemplateBlockEntity)
    private readonly blockRepository: Repository<ReportTemplateBlockEntity>,
  ) {}

  /**
   * 查生效中的模板
   * ⚠️ ADR-004 决策 3.2：`level` 对 audience='single' 只是 NOT NULL 的语义占位，
   *    过滤必须**先按 audience + scaleVersionId**，命中多条时取 id 最大者（最新导入的版本）。
   */
  findActiveTemplate(params: {
    audience: ReportAudience;
    scaleVersionId: number;
  }): Promise<ReportTemplateEntity | null> {
    return this.templateRepository.findOne({
      where: {
        audience: params.audience,
        scaleVersionId: params.scaleVersionId,
        status: STATUS_ON,
      },
      order: { id: 'DESC' },
    });
  }

  /** 模板区块（按 order_no 升序，渲染顺序即此顺序） */
  listBlocks(templateId: number): Promise<ReportTemplateBlockEntity[]> {
    return this.blockRepository.find({
      where: { templateId },
      order: { orderNo: 'ASC' },
    });
  }

  /** 一次装载模板与区块；无生效模板时返回 null（调用方决定降级策略） */
  async loadActiveTemplate(params: {
    audience: ReportAudience;
    scaleVersionId: number;
  }): Promise<LoadedReportTemplate | null> {
    const template = await this.findActiveTemplate(params);
    if (!template) return null;
    return { template, blocks: await this.listBlocks(template.id) };
  }
}
