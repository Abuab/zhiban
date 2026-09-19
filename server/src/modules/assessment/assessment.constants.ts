import { SCALE_CODE_16P, SCALE_CODE_PRE } from '../../engines/scale/scale.constants.js';
import type { AnswerSheetStatus, AssessmentScene, StartableScene } from './assessment.types.js';

/**
 * 测评域常量
 * 原则（宪法 P5）：可见文案与规则阈值一律落库/落配置，本文件只放**结构性常量**
 *   （状态机取值、场景与量表的绑定关系、入参上限），不放任何面向用户的文案。
 */

/** 答题卷状态（对应 answer_sheet.status） */
export const SHEET_STATUS_DRAFT: AnswerSheetStatus = 'draft';
export const SHEET_STATUS_SUBMITTED: AnswerSheetStatus = 'submitted';

/** 质量标记落库值（answer_sheet.quality_flag）：low 低质量（B3/B4） */
export const QUALITY_FLAG_LOW = 'low';

/** 场景取值（避免在业务代码中出现裸字符串字面量） */
export const SCENE_SINGLE: StartableScene = 'single';
export const SCENE_P16: StartableScene = 'p16';

/**
 * 双人邀请场景（模块 5）
 * 不属于 StartableScene（该场景不由用户直接「开始测评」发起，只能由邀请域创建），
 * 故单独成常量，避免把它塞进 SCENE_SCALE_CODE 造成「可按场景自由开始」的误解。
 */
export const SCENE_INVITE: AssessmentScene = 'invite';

/** 场景 → 量表编码（新增单人场景时在此登记，其余代码无需改动） */
export const SCENE_SCALE_CODE: Readonly<Record<StartableScene, string>> = {
  [SCENE_SINGLE]: SCALE_CODE_PRE,
  [SCENE_P16]: SCALE_CODE_16P,
};

/** 报告模板的 audience 取值（单人报告） */
export const REPORT_AUDIENCE_SINGLE = 'single';

/**
 * 付费墙锁定占位区块的 block_key
 * 该区块不属于报告正文（客户端用独立组件承载锁定态），故渲染时从 blocks 中剥离，
 * 单列返回 report.lockedHint（ADR-004 决策 3.3）。
 */
export const PAYWALL_BLOCK_KEY = 'LOCK_HINT';

/** 报告模板缺失时的对外提示（模板由 npm run report:seed 导入，缺失属部署事故） */
export const REPORT_TEMPLATE_MISSING_MESSAGE = '报告文案模板缺失，请联系客服';

/** 入参上限：单次提交答案的最大题数（防超大 payload；当前最大量表 76 题） */
export const MAX_ANSWER_COUNT = 200;

/** 入参上限：维度编码长度（与 scale_dimension.code varchar(32) 对齐） */
export const MAX_DIMENSION_CODE_LENGTH = 32;

/** 入参上限：题号长度（与 scale_question.code varchar(16) 对齐；ADR-013 逐题跳过入参用） */
export const MAX_QUESTION_CODE_LENGTH = 16;

/** 入参上限：作答时长上限（7 天，秒）——只用于拦异常值，正常作答为 8-10 分钟 */
export const MAX_DURATION_SEC = 7 * 24 * 3600;

/** 未作答题号在错误信息中最多列举的数量（避免拼接出超长文案） */
export const MISSING_CODE_PREVIEW_LIMIT = 5;
