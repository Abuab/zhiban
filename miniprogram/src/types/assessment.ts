/**
 * 测评域接口类型（镜像服务端）
 * 唯一真源：server/src/modules/assessment/assessment.types.ts（改动需两端同步）
 * 规格依据：边界总表 B1（断点续答与进度）/ B3、B4（低质量）/ B5（交卷锁定）/
 *          B7（敏感维度跳过与「未评估」）/ A3（多端乐观锁）
 */
import type { RenderedBlock } from './api';

/** 可开始的场景（invite 由模块 5 负责创建） */
export type StartableScene = 'single' | 'p16';

/** 全部作答场景（与服务端 answer_sheet.scene 一致） */
export type AssessmentScene = StartableScene | 'invite';

/** 答题卷状态 */
export type AnswerSheetStatus = 'draft' | 'submitted';

/** 量表题 / 选择题 / 二选一题 */
export type QuestionType = 'scale' | 'choice' | 'binary';

/** 题目选项（选择题为 ①②③…；二选一题为 A / B 两端点文案） */
export interface QuestionOption {
  key: string;
  label: string;
}

/**
 * 单个维度在报告中的可见结论
 * evaluated=false 有两种成因（ADR-013 决策 3）：
 *   1. 用户在敏感维度同意页拒绝授权被跳过（B7）；
 *   2. 该维度零有效作答（维度内每道计分题都未作答/被逐题跳过）。
 * 两种情况下 score **恒为 null**，绝不等于 0（ADR-004 决策 2）
 */
export interface DimensionOutcome {
  code: string;
  name: string;
  evaluated: boolean;
  score: number | null;
  /** 该维度实际计入均分的题数（ADR-013 决策 3；与题目定义数并列，供中性的事实陈述） */
  answeredCount: number;
  /** 参与计分的题目定义数（不含风格题与下架题） */
  scoredCount: number;
  /** 事后补答的维度（A-4），报告标记「补测」 */
  supplemented: boolean;
}

/** 16 型单维度结果（规则 8） */
export interface P16DimensionResult {
  dimensionCode: string;
  pole: 'A' | 'B';
  aCount: number;
  bCount: number;
  /** 平局（=3，A-7：取 B 端并记录标记） */
  isTie: boolean;
}

/**
 * 16 型单维度结论（在引擎结果上补充维度名）
 * 服务端补齐维度名，避免前端为四个维度名二次取数
 */
export type P16DimensionOutcome = P16DimensionResult & { dimensionName: string };

/** 16 型结论 */
export interface P16Outcome {
  /** 类型组合键，如 'B|B|A|A' */
  typeKey: string;
  /** 自研类型名（UI 不出现官方称谓，规格 2.2） */
  typeName: string;
  dimensions: P16DimensionOutcome[];
}

/** 作答质量标记（规则 7 / B3 / B4） */
export interface QualityFlag {
  isLowQuality: boolean;
  reasons: Array<'too_fast' | 'all_same'>;
  durationSec: number;
}

/** 对外暴露的题目（不含运营参考字段） */
export interface PaperQuestion {
  code: string;
  orderNo: number;
  type: QuestionType;
  title: string;
  reverse: boolean;
  isStyle: boolean;
  isBaseline: boolean;
  dimensionCode: string | null;
  options: QuestionOption[] | null;
}

/** 对外暴露的维度 */
export interface PaperDimension {
  code: string;
  name: string;
  orderNo: number;
  /** 敏感维度需前置单独同意（B7） */
  isSensitive: boolean;
  isScored: boolean;
}

/** 答题卷（题目与卷首文案取自答题卷锁定的量表版本，B8） */
export interface Paper {
  scaleCode: string;
  scaleName: string;
  scaleVersionId: number;
  scaleVersion: string;
  itemCount: number;
  /** 整卷卷首作答说明 */
  introText: string | null;
  /** 底线题组卷首文案；无底线题组为 null */
  baselineIntroText: string | null;
  dimensions: PaperDimension[];
  questions: PaperQuestion[];
}

/** 答题卷状态（客户端据此显示进度与「继续上次」） */
export interface SheetState {
  id: number;
  scene: AssessmentScene;
  status: AnswerSheetStatus;
  /** 乐观锁版本号（A3）：每次保存/交卷后由服务端 +1 */
  draftVersion: number;
  answeredCount: number;
  totalCount: number;
  progressPercent: number;
  answers: Record<string, number | string>;
  /** 整维拒绝授权被跳过的维度编码（B7） */
  skippedDimensions: string[];
  /**
   * 逐题拒绝作答的题号（ADR-013，仅敏感维度；**只对本人可见**，不向对方暴露）
   * 与 skippedDimensions 互斥：同一维度不得同时走两种跳过动作。
   */
  skippedQuestionCodes: string[];
  durationSec: number | null;
  qualityFlag: string | null;
  reportReady: boolean;
  startedAt: string | null;
  submittedAt: string | null;
}

/** 进入答题页所需的全部数据 */
export interface AssessmentDetail {
  sheet: SheetState;
  paper: Paper;
}

/** 续答入口摘要；无进行中的草稿时服务端返回 null */
export interface ResumeSummary {
  id: number;
  scene: AssessmentScene;
  answeredCount: number;
  totalCount: number;
  progressPercent: number;
  startedAt: string | null;
}

/** 雷达图单个维度（value 为 null = 未评估，B7 不参与绘制） */
export interface RadarItem {
  label: string;
  value: number | null;
}

/** 简版报告 */
export interface AssessmentReport {
  sheetId: number;
  scene: AssessmentScene;
  scaleCode: string;
  /** 量表名（报告页标题，服务端下发，前端不硬编码） */
  scaleName: string;
  scaleVersion: string;
  scaleVersionId: number;
  submittedAt: string | null;
  /** 雷达图数据（单场景 8 维，含未评估标记）；16 型场景为空数组 */
  dimensions: DimensionOutcome[];
  /** 正文文案区块（已剥离付费墙占位块）：blockKey = INTRO 或维度编码 */
  blocks: RenderedBlock[];
  /** 付费墙锁定占位文案（信息差可视化，不含内容本体） */
  lockedHint: string | null;
  /** 底线题触发提示（B9），未触发为 null */
  baselineNotice: string | null;
  /** 低质量提示（B3/B4），未触发为 null */
  lowQualityNotice: string | null;
  quality: QualityFlag;
  /** 页脚固定免责声明（规格 2.3） */
  disclaimer: string;
  /** 16 型结论（scene='p16' 时非空） */
  p16: P16Outcome | null;
}

/** 保存草稿入参 */
export interface SaveAnswersInput {
  draftVersion: number;
  answers?: Record<string, number | string>;
  skippedDimensions?: string[];
  /** 逐题拒绝作答的题号（ADR-013）：白名单只接受敏感维度内的题号，且与 skippedDimensions 不得有交集 */
  skippedQuestionCodes?: string[];
}

/** 交卷入参 */
export interface SubmitAssessmentInput extends SaveAnswersInput {
  durationSec: number;
}

/** 补答入参（只接受被跳过维度的题号） */
export interface SupplementInput {
  answers: Record<string, number | string>;
}
