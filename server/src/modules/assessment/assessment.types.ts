import type { RenderedBlock } from '../../engines/report/report.types.js';
import type {
  BaselineResult,
  P16DimensionResult,
  QualityFlag,
  QuestionOption,
  QuestionType,
} from '../../engines/scale/scale.types.js';

/**
 * 测评域领域类型（模块 4）
 *
 * 只描述「对外结构」与「落库缓存结构」，不 import 数据库实体，避免与 entity 互相依赖。
 * 规格依据：
 * - 边界总表 B1（断点续答与进度）/ B3、B4（低质量标记）/ B7（敏感维度跳过与「未评估」）
 * - docs/adr/ADR-004.md 决策 2（跳过维度须与「得 0 分」严格区分）/ 决策 3（报告区块约定）
 */

/** 单人测评支持的场景（invite 由模块 5 负责创建，此处不开放） */
export type StartableScene = 'single' | 'p16';

/** 全部作答场景（与 schema 的 answer_sheet.scene 取值一致） */
export type AssessmentScene = StartableScene | 'invite';

/** 答题卷状态（与 schema 的 answer_sheet.status 取值一致） */
export type AnswerSheetStatus = 'draft' | 'submitted';

/** 单个维度在报告中的可见结论 */
export interface DimensionOutcome {
  code: string;
  name: string;
  /**
   * 是否已评估
   * false = 用户在敏感维度同意页拒绝授权被跳过（B7），报告标注「未评估」
   */
  evaluated: boolean;
  /** 维度分（0-100，保留 1 位小数）；evaluated=false 时**恒为 null，绝不写 0**（ADR-004 决策 2） */
  score: number | null;
  /** 是否为事后补答的维度（A-4，报告标记「补测」） */
  supplemented: boolean;
}

/** 16 型单维度结论（在引擎结果上补充维度名，避免前端为四个维度名二次取数） */
export type P16DimensionOutcome = P16DimensionResult & { dimensionName: string };

/** 16 型结果（scene='p16'） */
export interface P16Outcome {
  /** 类型组合键，如 'B|B|A|A'（能量|信息|决策|生活） */
  typeKey: string;
  /** 自研类型名，如「守序者」（UI 不出现官方代号，规格 2.2） */
  typeName: string;
  dimensions: P16DimensionOutcome[];
}

/**
 * answer_sheet.dimension_scores_json 的内容
 * 定位：交卷时一次性算好并落库（schema 注释「本卷维度分缓存」），报告读取时不再重算，
 *   保证「用户看到的报告」与「交卷那一刻的计分」完全一致。
 */
export interface SheetScoresCache {
  /** 单场景：8 个计分维度的结论（含未评估标记） */
  dimensions: DimensionOutcome[];
  /** 单场景：底线题触发结果（B9） */
  baseline: BaselineResult;
  /** 作答质量标记（B3/B4） */
  quality: QualityFlag;
  /** 单场景：风格题 Q27 作答，供报告个性化；未作答为 null */
  styleAnswer: { code: string; value: number } | null;
  /** 16 型场景的结论；单场景为 null */
  p16: P16Outcome | null;
  /** 被跳过（未评估）的维度编码 */
  skipped: string[];
  /** 事后补答过的维度编码（A-4） */
  supplemented: string[];
  /** 计分时刻（ISO 8601），便于排查 */
  computedAt: string;
}

/** 对外暴露的题目（**刻意不含 ext_json 的考察点**：那是运营参考，不进用户端） */
export interface PaperQuestion {
  code: string;
  orderNo: number;
  type: QuestionType;
  title: string;
  reverse: boolean;
  isStyle: boolean;
  isBaseline: boolean;
  dimensionCode: string | null;
  /** 量表题为 null（固定 1-5）；选择题 / 二选一题必填 */
  options: QuestionOption[] | null;
}

/** 对外暴露的维度 */
export interface PaperDimension {
  code: string;
  name: string;
  orderNo: number;
  /** 敏感维度需前置单独同意页（B7，隐私约束 2.4） */
  isSensitive: boolean;
  isScored: boolean;
}

/**
 * 答题卷（B8：题目与卷首文案取自 answer_sheet 锁定的量表版本，不随题库改版漂移）
 */
export interface Paper {
  scaleCode: string;
  scaleName: string;
  scaleVersionId: number;
  scaleVersion: string;
  /** 题目总数（进度分母基准，A-1） */
  itemCount: number;
  /** 整卷卷首作答说明（规格第 293 行） */
  introText: string | null;
  /** 底线题组卷首文案（规格第 408 行）；无底线题组为 null */
  baselineIntroText: string | null;
  dimensions: PaperDimension[];
  questions: PaperQuestion[];
}

/** 答题卷状态（断点续答 B1：客户端据此显示「继续上次（已完成 32/76 题）」） */
export interface SheetState {
  id: number;
  scene: AssessmentScene;
  status: AnswerSheetStatus;
  /** 乐观锁版本号（A3 多端防覆盖） */
  draftVersion: number;
  /** 已作答题数 */
  answeredCount: number;
  /** 需作答题数（= itemCount 扣除被跳过维度的题数；无跳过时即 itemCount，A-1） */
  totalCount: number;
  /** 进度百分比（0-100 整数） */
  progressPercent: number;
  answers: Record<string, number | string>;
  skippedDimensions: string[];
  durationSec: number | null;
  qualityFlag: string | null;
  /** 是否已交卷（交卷后答案锁定，B5） */
  reportReady: boolean;
  startedAt: string | null;
  submittedAt: string | null;
}

/** 进入答题页所需的全部数据（一次请求拉齐，减少小程序往返） */
export interface AssessmentDetail {
  sheet: SheetState;
  paper: Paper;
}

/** 续答入口摘要（GET current）；无进行中的草稿时为 null */
export interface ResumeSummary {
  id: number;
  scene: AssessmentScene;
  answeredCount: number;
  totalCount: number;
  progressPercent: number;
  startedAt: string | null;
}

/**
 * 简版报告（模块 4 完成标准：一个人可以从头到尾测完并看到简版报告）
 * 定价规范：单人测评 + 简版报告免费，内容 = 8 维度答题 + 雷达图 + 一句话点评
 */
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
  /** 正文文案区块（已剥离付费墙占位块，按 orderNo 升序） */
  blocks: RenderedBlock[];
  /**
   * 付费墙锁定占位文案（模板 block_key = LOCK_HINT）
   * 只说明解锁后可获得的内容**类别**，不含内容本体（价值感标准 §三 信息差可视化）
   */
  lockedHint: string | null;
  /** 底线题触发提示（B9，未触发为 null） */
  baselineNotice: string | null;
  /** 低质量提示（B3/B4，未触发为 null） */
  lowQualityNotice: string | null;
  quality: QualityFlag;
  /** 页脚固定免责声明（规格 2.3，取自 report_template.disclaimer） */
  disclaimer: string;
  /** 16 型结论（scene='p16' 时非空） */
  p16: P16Outcome | null;
}

/**
 * 邀请交卷结果（模块 5）
 *
 * 为什么返回「原始数据」而不是「报告」：邀请域要把它原样冻结进 `answer_snapshot`（B8 不可变），
 * 报告是双方齐备后由异步 worker 生成的，交卷这一刻还没有对比报告可给。
 */
export interface InviteSubmitResult {
  sheetId: number;
  answers: Record<string, number | string>;
  /** 与交卷时落库完全一致的计分缓存（含 dimensions / baseline / quality / skipped） */
  cache: SheetScoresCache;
  durationSec: number;
  qualityFlag: string | null;
}

/** 可复用的历史单人答卷（C3 / R7：被邀请方已完成同版本单人测评时可选择复用） */
export interface ReusableSingleSheet {
  sheetId: number;
  submittedAt: string | null;
  answers: Record<string, number | string>;
  cache: SheetScoresCache;
  durationSec: number | null;
  qualityFlag: string | null;
}

/**
 * 最近一次已交卷答卷的快照（模块 7 专属卡 prompt 取数，ADR-008 决策 1）
 *
 * 为什么单独成类型而不复用 `ReusableSingleSheet`：后者带 `answers` 与量表版本校验语义，
 * 用于「把历史答案当作本次双人作答」；专属卡只要「人格类型 / 维度分」这些结论，
 * 取到原始答案反而扩大了数据暴露面（privacy by design），故单独出一个更窄的结构。
 */
export interface LatestSubmittedSheet {
  sheetId: number;
  scene: AssessmentScene;
  scaleVersionId: number;
  submittedAt: string | null;
  /** 交卷时落库的计分缓存（16 型取 `p16`，婚前评估取 `dimensions`） */
  cache: SheetScoresCache;
}
