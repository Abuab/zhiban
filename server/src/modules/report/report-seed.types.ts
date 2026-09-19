import type { ReportAudience, ReportLevel } from './entities/report-template.entity.js';

/**
 * 报告模板区块种子（纯数据，供导入脚本写库）
 * block_key 约定见 docs/adr/ADR-004.md 决策 3
 */
export interface ReportTemplateBlockSeed {
  /** 区块键：单人简版为维度编码，或 INTRO / LOCK_HINT；双人完整版另含 CONSENSUS / PENDING / ENDING */
  blockKey: string;
  /** 排序号（同一模板内必须唯一） */
  orderNo: number;
  /**
   * 差值档位：high / mid / low；不填 = 不限档
   * ADR-005 决策 2：双人完整版的维度解读按差值等级分档，同一 blockKey 会有 3 行
   */
  gapLevel?: 'high' | 'mid' | 'low' | null;
  /** 内容详实度下限（字符数）；简版无下限要求，为 null */
  minChars: number | null;
  /** 占位符文本（{维度名} {分数A} {分数B} {昵称A} {昵称B} {差值} 等） */
  templateText: string;
}

/** 报告模板种子 */
export interface ReportTemplateSeed {
  /** 模板编码，如 SINGLE-PRE-LITE */
  code: string;
  /** 所属量表编码（SCALE-PRE / SCALE-16P），导入时据此解析 scale_version_id */
  scaleCode: string;
  /** 量表版本号，如 1.0 */
  scaleVersion: string;
  audience: ReportAudience;
  /** audience='single' 时固定 'L1'（ADR-004 决策 3.2：语义占位，不参与三层过滤） */
  level: ReportLevel;
  /** 页脚固定免责声明（规格 2.3 原文） */
  disclaimer: string;
  version: string;
  blocks: ReportTemplateBlockSeed[];
}
