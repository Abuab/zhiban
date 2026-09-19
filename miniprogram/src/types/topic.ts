/**
 * 锦囊卡片流域类型（模块 7，镜像服务端）
 * 唯一真源：server/src/modules/topic/topic.types.ts（改动需两端同步）
 * 契约文档：docs/api.md §15
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.1（生成位置）/ §9.4（前端渲染）/ §9.5（CMS 格式）、
 *          docs/adr/ADR-007.md（免费领取 / 生成一次缓存 / 单人版降级）、
 *          docs/adr/ADR-008.md（prompt 数据口径 / owner_uid 缓存归属）
 */

/** 卡片类型（`exclusive` 不在此列：专属卡是最后一卡，由 `exclusiveCard` 承载） */
export type TopicCardType = 'pitfall' | 'script' | 'quiz' | 'cognition' | 'action';

/** 演练卡选项（含答案与解析：服务端一次性下发，端上点选后立即可判，无二次请求） */
export interface TopicCardOption {
  key: string;
  text: string;
  correct: boolean;
  explain: string;
}

/** 卡片流中的一张卡 */
export interface TopicCardView {
  /** 卡序（swiper 顺序；**从 0 起**，与专属卡「最后一卡」的位置区分开） */
  orderNo: number;
  type: string;
  title: string | null;
  body: string;
  /** true = 支持长按复制（话术卡，§9.4） */
  copyable: boolean;
  /** 演练卡才非空 */
  options: TopicCardOption[] | null;
}

/**
 * 专属卡对外状态
 *
 * ⚠️ 接口刻意**不下发**生成状态与降级原因：降级内容与模型内容在端上必须长得一样
 *    （ADR-008 §九「避免用户感到被降级对待」），端上只按 `locked` / `ready` 分支。
 */
export interface ExclusiveCardView {
  /** 未解锁 = 渲染锁形占位 + 价格（不渲染 content）；解锁判定一律以服务端为准 */
  locked: boolean;
  /** 单位：元；已解锁或商品缺失为 null */
  price: number | null;
  /** 是否已有可展示内容（含降级内容） */
  ready: boolean;
  /** 未解锁时恒为 null（付费墙在服务端） */
  content: string | null;
  generatedAt: string | null;
}

/** 阅读进度 */
export interface TopicProgressView {
  /** 上次停留的卡序（0 = 未读过） */
  lastOrderNo: number;
  finished: boolean;
}

/** 议题列表项（GET /v1/topics） */
export interface TopicListItem {
  code: string;
  title: string;
  subtitle: string | null;
  unlocked: boolean;
  lastOrderNo: number;
  finished: boolean;
  /** 挂载维度编码；报告「待沟通区」按维度反查议题包入口用 */
  mountDimensions: string[];
}

/** 议题详情 / 卡片流（GET /v1/topics/:code） */
export interface TopicDetailView {
  code: string;
  title: string;
  subtitle: string | null;
  mountDimensions: string[];
  /** 不含专属卡（专属卡单独在 exclusiveCard） */
  cards: TopicCardView[];
  progress: TopicProgressView;
  exclusiveCard: ExclusiveCardView;
}

/** 进度上报入参（PUT /v1/topics/:code/progress） */
export interface SaveTopicProgressInput {
  lastOrderNo: number;
  /** 不传 = 不改变既有打卡状态 */
  finished?: boolean;
}

/** 进度上报结果（服务端回传落库值，端上据此纠正本地缓存） */
export interface TopicProgressAck extends TopicProgressView {
  code: string;
}
