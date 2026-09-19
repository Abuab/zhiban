import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { DoubleConsensusItem, DoubleFlaggedItem, GapLevel } from '../../engines/report/double-report.engine.js';
import type { RenderContext, RenderedBlock } from '../../engines/report/report.types.js';
import { renderBlocks } from '../../engines/report/template.engine.js';
import { BASELINE_NOTICE_MESSAGE, LOW_QUALITY_NOTICE_MESSAGE } from '../../engines/scale/scale.constants.js';
import {
  DOUBLE_BLOCK,
  REPORT_PLACEHOLDER,
  SHARE_FORBIDDEN_PLACEHOLDERS,
} from './report.constants.js';
import type {
  DoubleReportRenderInput,
  DoubleReportRenderResult,
  RenderableTemplate,
  StoredDoubleReport,
} from './report.types.js';

/** 合并后的维度行（差值分级 + 双方分值，渲染的最小单位） */
interface DimensionRow {
  dimensionCode: string;
  dimensionName: string;
  gap: number;
  level: GapLevel;
  levelLabel: string;
  scoreA: number;
  scoreB: number;
  /** A 方该维度实际计入均分的题数（ADR-013 决策 4） */
  answeredCountA: number;
  /** B 方该维度实际计入均分的题数（口径同上） */
  answeredCountB: number;
  /** 该维度参与计分的题目定义数（分母） */
  scoredCount: number;
}

/**
 * 双人报告渲染服务（模块 5）
 *
 * 职责：把 `report` 表的落库结论 + 模板区块 → 三层各自的正文。
 * 只做「取值 + 拼装 + 裁剪」，不做任何业务算法（差值/分级已在生成期由 L1 引擎算好并落库）。
 *
 * 规格依据：
 * - architecture.md「报告域：渲染时读取；改文案零发版」
 * - 规范增补 v0.2 §3.1 三层可见模型（L2 无差值无分歧；L3 默认仅共识区）
 * - docs/adr/ADR-005.md 决策 2（维度解读按差值等级取对应档位）、决策 4（L3 白名单裁剪）
 *
 * 安全自查（铁律 #6）：
 *   1. **L2/L3 用受限上下文**：分值/差值/分歧类占位符根本不在上下文中，模板即使误写也渲染不出来；
 *      且这两层**丢弃带缺失占位符的区块**（fail-closed），避免把 `{分数A}` 原样发出去暴露字段名。
 *   2. **L3 额外做禁用键扫描**：渲染前先按 SHARE_FORBIDDEN_PLACEHOLDERS 扫一遍原始模板文本，
 *      命中即丢块并告警 —— 不依赖「上下文里没有」这一层，双保险。
 *   3. 未评估维度不出现在 L1 的比对列表（无差值），只进「未评估清单」，防止把「未评估」当 0 分播出去。
 */
@Injectable()
export class DoubleReportRenderService {
  constructor(private readonly logger: AppLogger) {}

  render(input: DoubleReportRenderInput): DoubleReportRenderResult {
    const dimensionRows = this.mergeDimensionRows(input.data);
    const consensusItems = this.selectConsensus(input);
    const divergenceItems = this.mergeDivergence(input.data);

    const baseContext = this.buildBaseContext(input, consensusItems);
    const droppedBlocks: Array<{ blockKey: string; reason: string }> = [];
    const missingKeys = new Set<string>();
    const blocks: RenderedBlock[] = [];

    for (const block of [...input.template.blocks].sort((left, right) => left.orderNo - right.orderNo)) {
      if (!this.shouldRender(block, input, dimensionRows, consensusItems, divergenceItems)) continue;

      // L3 双保险：原始模板文本里出现禁用占位符 → 丢弃并告警（绝不把分数画进长图）
      if (input.level === 'L3') {
        const forbidden = SHARE_FORBIDDEN_PLACEHOLDERS.find((key) =>
          block.templateText.includes(`{${key}}`),
        );
        if (forbidden) {
          droppedBlocks.push({ blockKey: block.blockKey, reason: `L3 模板含禁用占位符 {${forbidden}}` });
          continue;
        }
      }

      const context = this.buildBlockContext(block, input, baseContext, dimensionRows, consensusItems);
      const [rendered] = renderBlocks([block], context);
      if (!rendered) continue;

      // L2/L3 受限上下文：出现缺失占位符即说明模板引用了不该用的字段 → 丢块（fail-closed）
      if (input.level !== 'L1' && rendered.missingKeys.length > 0) {
        droppedBlocks.push({
          blockKey: block.blockKey,
          reason: `该层级不可用的占位符：${rendered.missingKeys.join('、')}`,
        });
        continue;
      }

      for (const key of rendered.missingKeys) missingKeys.add(key);
      if (!rendered.meetsMinChars) {
        this.logger.warn(
          `报告区块未达内容详实度下限：level=${input.level} blockKey=${block.blockKey} ` +
            `下限=${block.minChars ?? 0} 实际=${[...rendered.text].length}`,
          'DoubleReportRenderService',
        );
      }
      blocks.push(rendered);
    }

    if (droppedBlocks.length > 0) {
      this.logger.warn(
        `报告渲染丢弃 ${droppedBlocks.length} 个区块（防越层泄露）：level=${input.level} ` +
          droppedBlocks.map((item) => `${item.blockKey}(${item.reason})`).join('；'),
        'DoubleReportRenderService',
      );
    }

    return {
      blocks,
      droppedBlocks,
      missingKeys: [...missingKeys],
      templateId: input.template.templateId,
      disclaimer: input.template.disclaimer,
    };
  }

  /** 合并「双方分数」与「差值分级」两张表（两个 JSON 列分开落库，渲染时需要合看） */
  mergeDimensionRows(data: StoredDoubleReport): DimensionRow[] {
    const scoreByCode = new Map(
      data.dimensionScores.dimensions.map((row) => [row.dimensionCode, row]),
    );
    const rows: DimensionRow[] = [];
    for (const diff of data.diffs.rows) {
      const score = scoreByCode.get(diff.dimensionCode);
      // 分数缺失说明落库结构被改坏：跳过该维度而不是补 0（0 分是合法取值，补 0 会造出假差值）
      if (!score) continue;
      rows.push({
        ...diff,
        scoreA: score.scoreA,
        scoreB: score.scoreB,
        // 作答完整度（ADR-013 决策 4）：早于本字段的历史报告读出来是 undefined，
        // 统一兜底为 0 —— 端上「x < y 才展示」的判定在 0 / 0 下不成立，历史报告只是不显示该行，
        // 不会把 undefined 渲染成文字（也要防 undefined 参与 `<` 比较产生 NaN 误判）。
        answeredCountA: score.answeredCountA ?? 0,
        answeredCountB: score.answeredCountB ?? 0,
        scoredCount: score.scoredCount ?? 0,
      });
    }
    return rows;
  }

  /** 逐题分歧（量表 + 选择，按分差降序，前端按此顺序展示） */
  mergeDivergence(data: StoredDoubleReport): DoubleFlaggedItem[] {
    return [...data.flagged.scale, ...data.flagged.choice].sort((left, right) => right.gap - left.gap);
  }

  /** L3 勾选裁剪：未勾选（或未传）时按「默认仅共识区」输出全部共识项 */
  private selectConsensus(input: DoubleReportRenderInput): DoubleConsensusItem[] {
    const picked = input.shareConsensusCodes;
    if (input.level !== 'L3' || !picked || picked.length === 0) return input.data.consensus;
    const wanted = new Set(picked);
    return input.data.consensus.filter((item) => wanted.has(item.questionCode));
  }

  /** 各层共用的基础上下文（L2/L3 刻意不含分值/差值/分歧） */
  private buildBaseContext(
    input: DoubleReportRenderInput,
    consensusItems: DoubleConsensusItem[],
  ): RenderContext {
    const context: RenderContext = {
      [REPORT_PLACEHOLDER.NICKNAME_A]: input.nicknames.a,
      [REPORT_PLACEHOLDER.NICKNAME_B]: input.nicknames.b,
      [REPORT_PLACEHOLDER.CONSENSUS_LIST]: this.formatConsensusList(consensusItems),
    };

    if (input.level === 'L1') {
      context[REPORT_PLACEHOLDER.SCALE_VERSION] = input.scaleVersion;
      context[REPORT_PLACEHOLDER.PENDING_LIST] = this.formatPendingList(
        this.mergeDimensionRows(input.data).filter((row) => row.level !== 'high'),
      );
      context[REPORT_PLACEHOLDER.DIVERGENCE_LIST] = this.formatDivergenceList(
        this.mergeDivergence(input.data),
      );
      context[REPORT_PLACEHOLDER.UNEVALUATED_LIST] = input.data.dimensionScores.unevaluated
        .map((row) => row.dimensionName)
        .join('、');
      context[REPORT_PLACEHOLDER.BASELINE_NOTICE] = BASELINE_NOTICE_MESSAGE;
      context[REPORT_PLACEHOLDER.QUALITY_NOTICE] = LOW_QUALITY_NOTICE_MESSAGE;
      return context;
    }

    if (input.level === 'L2') {
      context[REPORT_PLACEHOLDER.SCALE_VERSION] = input.scaleVersion;
      // R5：底线题提示**双向**同一文案
      context[REPORT_PLACEHOLDER.BASELINE_NOTICE] = BASELINE_NOTICE_MESSAGE;
      return context;
    }

    context[REPORT_PLACEHOLDER.DATE] = this.formatDate(input.renderedAt);
    return context;
  }

  /** 单块上下文：维度解读块（blockKey = 维度编码且带档位）补上本维度的分值与差值 */
  private buildBlockContext(
    block: RenderableTemplate['blocks'][number],
    input: DoubleReportRenderInput,
    baseContext: RenderContext,
    dimensionRows: DimensionRow[],
    consensusItems: DoubleConsensusItem[],
  ): RenderContext {
    if (block.gapLevel == null) return baseContext;

    const row = dimensionRows.find((item) => item.dimensionCode === block.blockKey);
    if (!row) return baseContext;

    return {
      ...baseContext,
      [REPORT_PLACEHOLDER.DIMENSION_NAME]: row.dimensionName,
      [REPORT_PLACEHOLDER.SCORE_A]: row.scoreA,
      [REPORT_PLACEHOLDER.SCORE_B]: row.scoreB,
      [REPORT_PLACEHOLDER.GAP]: row.gap,
      [REPORT_PLACEHOLDER.GAP_LABEL]: row.levelLabel,
      // L3 不会走到这里（L3 模板不允许带档位的维度解读块，禁用键扫描已拦）
      [REPORT_PLACEHOLDER.CONSENSUS_LIST]: this.formatConsensusList(consensusItems),
    };
  }

  /**
   * 区块是否渲染
   * 1. 分档区块：只渲染**命中该维度实际档位**的那一行（ADR-005 决策 2）
   * 2. 条件区块：数据为空/未触发时整块不出现（报告里不留「本区暂无内容」这种空洞）
   */
  private shouldRender(
    block: RenderableTemplate['blocks'][number],
    input: DoubleReportRenderInput,
    dimensionRows: DimensionRow[],
    consensusItems: DoubleConsensusItem[],
    divergenceItems: DoubleFlaggedItem[],
  ): boolean {
    if (block.gapLevel != null) {
      const row = dimensionRows.find((item) => item.dimensionCode === block.blockKey);
      return row !== undefined && row.level === (block.gapLevel as GapLevel);
    }

    switch (block.blockKey) {
      case DOUBLE_BLOCK.PENDING:
        return dimensionRows.some((row) => row.level !== 'high');
      case DOUBLE_BLOCK.DIVERGENCE:
        return divergenceItems.length > 0;
      case DOUBLE_BLOCK.UNEVALUATED:
        return input.data.dimensionScores.unevaluated.length > 0;
      case DOUBLE_BLOCK.CONSENSUS:
      case DOUBLE_BLOCK.SHARE_CONSENSUS:
        return consensusItems.length > 0;
      case DOUBLE_BLOCK.BASELINE_NOTICE:
        return input.baselineTriggered;
      case DOUBLE_BLOCK.QUALITY_NOTICE:
        return input.lowQuality;
      default:
        return true;
    }
  }

  private formatPendingList(rows: DimensionRow[]): string {
    return rows
      .map(
        (row) =>
          `${row.dimensionName}：你 ${row.scoreA} 分，TA ${row.scoreB} 分，相差 ${row.gap} 分（${row.levelLabel}）`,
      )
      .join('\n');
  }

  private formatDivergenceList(items: DoubleFlaggedItem[]): string {
    return items
      .map((item) => {
        const selfAnswer = item.optionLabelA ?? (item.scoreA === null ? '未作答' : `${item.scoreA} 分`);
        const partnerAnswer = item.optionLabelB ?? (item.scoreB === null ? '未作答' : `${item.scoreB} 分`);
        return `${item.questionTitle}：你「${selfAnswer}」，TA「${partnerAnswer}」`;
      })
      .join('\n');
  }

  /** 共识清单（仅正向；L2/L3 的唯一实质内容） */
  private formatConsensusList(items: DoubleConsensusItem[]): string {
    return items.map((item) => `${item.questionTitle}：你们都选了「${item.optionLabel}」`).join('\n');
  }

  /** 日期文案（本地时区的 YYYY-MM-DD；长图纪念用途，不含时分秒） */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
