/**
 * 锦囊卡片流域前端常量（模块 7）
 *
 * 原则（同 constants/invite.ts）：只放**结构性常量与规格已固定的文案**；
 *   随运营变化的文案一律由服务端下发 —— 议题标题/副标题、卡片正文、演练卡选项与解析、
 *   专属卡内容、解锁价格全部来自接口，端上不承载运营文案（宪法 P5）。
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.1（生成位置）/ §9.4（前端渲染）/ §9.5（CMS 格式）、
 *          docs/adr/ADR-007.md、docs/adr/ADR-008.md
 */

/** 卡片类型取值（与服务端 topic.constants.ts 同源，避免业务代码出现裸字符串） */
export const CARD_TYPE = {
  PITFALL: 'pitfall',
  SCRIPT: 'script',
  QUIZ: 'quiz',
  COGNITION: 'cognition',
  ACTION: 'action',
} as const;

/**
 * 卡片类型角标文案
 *
 * 为什么端上写死这几个词：它们是**卡型标签**（§9.5 的 `type` 枚举的中文名），
 *   8 个议题共用同一套，不随运营变化；运营改的永远是卡片正文。
 */
export const CARD_TYPE_LABELS: Record<string, string> = {
  [CARD_TYPE.PITFALL]: '坑',
  [CARD_TYPE.SCRIPT]: '话术',
  [CARD_TYPE.QUIZ]: '演练',
  [CARD_TYPE.COGNITION]: '认知',
  [CARD_TYPE.ACTION]: '行动',
};

/** 服务端新增卡型而端上未同步时的兜底角标（不显示英文枚举） */
export const CARD_TYPE_FALLBACK_LABEL = '锦囊';

/** 内容域页面路径（集中登记：路径写散后改目录必漏，且 pages.json 必须与之一字不差） */
export const TOPIC_LIST_PAGE_PATH = '/pages/topic/index';
export const TOPIC_DETAIL_PAGE_PATH = '/pages/topic/detail';

/**
 * 话术卡长按复制的交互文案
 * §9.4「长按弹出『复制』action-sheet」：先弹面板再复制，避免误触把正文写进剪贴板。
 */
export const COPY_ACTION_SHEET_ITEM = '复制这段话';
export const COPY_SUCCESS_TOAST = '已复制，可以直接粘贴给 TA';

/**
 * 阅读进度上报节流（毫秒）
 *
 * 滑动会高频触发 `change`，每次都打接口既费流量也会被限流；服务端本身是单调不减的，
 *   故只在卡序**确实变化**时上报，并保证至少间隔这么久。
 */
export const PROGRESS_REPORT_INTERVAL_MS = 1200;

/** 专属卡未解锁时的占位标题（§9.1 原文） */
export const EXCLUSIVE_LOCKED_TITLE = '生成你们的专属版本';

/** 解锁按钮文案（价格由服务端下发，端上不写死金额） */
export const EXCLUSIVE_UNLOCK_ACTION = '解锁本议题包';

/** 已解锁但尚未生成时的按钮文案（§9.1 原文） */
export const EXCLUSIVE_GENERATE_ACTION = '生成你们的专属版本';

/** 生成等待文案（§9.4：已解锁 = 骨架屏 → 内容淡入） */
export const EXCLUSIVE_GENERATING_TEXT = '正在为你们生成…';

/** 生成失败（50004 并发中）时的提示 */
export const EXCLUSIVE_BUSY_TOAST = '专属建议正在生成，请稍后刷新';

/** 打卡按钮文案（§9.4「已读进度本地记录，可续看」+ 列表页 `finished` 展示） */
export const TOPIC_FINISH_ACTION = '学会了，收进心里';

/** 已打卡标记 */
export const TOPIC_FINISHED_BADGE = '已学会';
