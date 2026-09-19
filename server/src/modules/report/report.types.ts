import type {
  DoubleConsensusItem,
  DoubleFlaggedItem,
  GapLevel,
} from '../../engines/report/double-report.engine.js';
import type { RenderedBlock, TemplateBlock } from '../../engines/report/report.types.js';
import type { ReportLevel } from './entities/report-template.entity.js';

/**
 * 报告域领域类型（模块 5）
 *
 * 两类结构严格分开：
 *   1. **落库结构**（StoredXxx）：report 表的四个 JSON 列的内容，写入方（邀请域）与读取方（本域）共用；
 *   2. **对外结构**（DoubleReportL1View / L2View / L3Material）：三层可见模型的对外出口，
 *      按层级**各自成类型**而不是「一个大对象 + 可选字段」，让「L2 不可能带上分数」由类型系统保证。
 *
 * 规格依据：PRD-002 R3/R5；规范增补 v0.2 §3.1；docs/adr/ADR-005.md 决策 2/4/5
 */

/** report.dimension_scores_json 的内容：双方各维度分 + 任一方未评估的维度 */
export interface StoredDimensionScores {
  /** 已参与比对的维度（含双方分数；差值见 diffs） */
  dimensions: Array<{
    dimensionCode: string;
    dimensionName: string;
    scoreA: number;
    scoreB: number;
  }>;
  /** 任一方跳过（未评估）的维度：不参与比对，报告统一标注「未评估」（ADR-005 决策 7） */
  unevaluated: Array<{ dimensionCode: string; dimensionName: string }>;
}

/** report.diffs_json 的内容：各维度绝对差 + 分级（D6 阈值归低一级） */
export interface StoredDiffs {
  rows: Array<{
    dimensionCode: string;
    dimensionName: string;
    gap: number;
    level: GapLevel;
    /** 中性分级名（高共识 / 待沟通 / 重点待沟通），取自 scoring_rule.labels_json */
    levelLabel: string;
  }>;
  /** 归入「高共识」的维度编码（模板分档渲染与客户端分区共用同一判定源） */
  consensusCodes: string[];
  /** 归入「待沟通 / 重点待沟通」的维度编码 */
  pendingCodes: string[];
}

/** report.flagged_items_json 的内容：逐题分歧明细（R2） */
export interface StoredFlaggedItems {
  /** 量表题分歧（有维度归属，每维度按分差降序取前 2） */
  scale: DoubleFlaggedItem[];
  /** 选择/二选一题分歧（无维度归属） */
  choice: DoubleFlaggedItem[];
}

/** 从 report 行解析出的报告数据（渲染输入） */
export interface StoredDoubleReport {
  dimensionScores: StoredDimensionScores;
  diffs: StoredDiffs;
  flagged: StoredFlaggedItems;
  /** 共识区（仅正向；L2 的唯一实质内容来源） */
  consensus: DoubleConsensusItem[];
}

/** 报告状态取值（与 report.status 列取值一致，常量同源 REPORT_STATUS） */
export type ReportStatus = 'pending' | 'ready' | 'failed';

/** 渲染所需的模板（ReportTemplateService 装载结果的窄化，便于单测直接构造） */
export interface RenderableTemplate {
  templateId: number;
  disclaimer: string;
  /** 含档位与下限的区块（结构上兼容 report_template_block 实体） */
  blocks: Array<
    TemplateBlock & { blockKey: string; orderNo: number; gapLevel?: string | null; minChars?: number | null }
  >;
}

/** 报告渲染输入（渲染服务只依赖本结构，不碰数据库） */
export interface DoubleReportRenderInput {
  level: ReportLevel;
  template: RenderableTemplate;
  data: StoredDoubleReport;
  /** 双方昵称（A=发起方，B=被邀请方；为空时由调用方给兜底文案） */
  nicknames: { a: string; b: string };
  /** 量表版本号（D5：报告页标注量表版本） */
  scaleVersion: string;
  /** 底线题触发（R5：向双方提示核实，不含关系判词）；未触发时该区块整块不出现 */
  baselineTriggered: boolean;
  /** 任一方低质量标记（C10：仅统一提示，不暴露是哪一方） */
  lowQuality: boolean;
  /** 渲染时刻（L3 长图日期用） */
  renderedAt: Date;
  /** L3 专用：发起方勾选的共识项题号；为空数组时按「默认仅共识区」全量输出 */
  shareConsensusCodes?: string[];
}

/** 渲染结果（含渲染告警，供调用方记日志） */
export interface DoubleReportRenderResult {
  blocks: RenderedBlock[];
  /** 被丢弃的区块（L2/L3 出现缺失或被禁用占位符），已记入 warn 日志 */
  droppedBlocks: Array<{ blockKey: string; reason: string }>;
  /** 模板里未被填充的占位符名（L1 只告警不丢块） */
  missingKeys: string[];
  /** 本次渲染命中的模板 id */
  templateId: number;
  disclaimer: string;
}

/** 报告未生成完成时的对外提示（前端据此展示「生成中/失败」并轮询，R6/D1） */
export interface DoubleReportPendingView {
  reportId: number | null;
  level: ReportLevel;
  status: ReportStatus;
  /** 生成失败时给用户的可执行提示（前端展示 + 联系客服） */
  message: string;
}

/** L1 完整版（发起方）：雷达图 + 差值 + 待沟通区 + 逐题分歧 + 锦囊入口 */
export interface DoubleReportL1View {
  reportId: number;
  inviteId: number;
  level: 'L1';
  status: 'ready';
  scaleVersion: string;
  generatedAt: string;
  /** 本人昵称（雷达图图例 A 端） */
  selfNickname: string;
  /** 对方昵称（雷达图图例 B 端） */
  partnerNickname: string;
  /** 各维度双方分值与差值（雷达图 + 差值列表数据源） */
  dimensions: Array<{
    dimensionCode: string;
    dimensionName: string;
    scoreA: number;
    scoreB: number;
    gap: number;
    level: GapLevel;
    levelLabel: string;
  }>;
  /** 任一方未评估的维度（UI 标注「未评估」，不参与差值） */
  unevaluatedDimensions: StoredDimensionScores['unevaluated'];
  /** 高共识维度编码 */
  consensusCodes: string[];
  /** 待沟通 / 重点待沟通维度编码 */
  pendingCodes: string[];
  /** 逐题分歧明细（R2；R4 约束的是「对方完整答卷」，分歧题双方作答由规范增补 v0.2 §3.1 授予发起方） */
  divergenceItems: DoubleFlaggedItem[];
  /** 共识区（仅正向） */
  consensusItems: DoubleConsensusItem[];
  /** 底线题核实提示（R5；未触发为 null） */
  baselineNotice: string | null;
  /** 作答质量统一提示（C10；不暴露是哪一方，无低质量为 null） */
  lowQualityNotice: string | null;
  /** 模板渲染的正文区块（改文案零发版） */
  blocks: RenderedBlock[];
  disclaimer: string;
}

/** L2 基础版（被邀请方）：纪念卡 + 共识区（仅正向），**无差值无分歧**（R3） */
export interface DoubleReportL2View {
  reportId: number;
  inviteId: number;
  level: 'L2';
  status: 'ready';
  scaleVersion: string;
  generatedAt: string;
  selfNickname: string;
  partnerNickname: string;
  /** 共识区（仅正向；本层唯一的实质内容） */
  consensusItems: DoubleConsensusItem[];
  /** 底线题核实提示（R5：双方同时收到同一文案） */
  baselineNotice: string | null;
  /** L2 不含低质量提示（C10：质量提示只在完整版统一呈现，避免被邀请方被"标记"感） */
  blocks: RenderedBlock[];
  disclaimer: string;
}

/** L3 分享版长图素材（ADR-005 决策 4：服务端只下发素材，端上 canvas 合成） */
export interface DoubleReportL3Material {
  reportId: number;
  level: 'L3';
  /** 长图标题（已过 P7 过滤，仅正向） */
  title: string;
  nicknames: { a: string; b: string };
  /** 日期文案（YYYY-MM-DD） */
  date: string;
  /** 可绘制的正向区块（默认仅共识区与正向引导） */
  blocks: RenderedBlock[];
  /** 水印串（服务端计算的 user_id 哈希，端上只负责绘制，D3） */
  watermark: string;
  disclaimer: string;
}
