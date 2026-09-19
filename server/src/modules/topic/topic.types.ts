import type { TopicCardOption } from './entities/topic-card.entity.js';

/**
 * 内容域对外结构（模块 7，ADR-007 / ADR-008）
 *
 * 只描述**下发给端上的结构**，不含实体、不含 `topic_card.status` 等运营字段。
 * 规格依据：《锦囊卡片流 v1.0》§9.1（专属卡位置）/ §9.4（前端渲染）/ §9.5（CMS 格式）；
 *   ADR-007 附带决策 3（阅读进度服务端记录）/ 4（议题挂载维度）；
 *   ADR-008 附带决策 3（解锁判定由服务端下发 `locked`）。
 */

/** 卡片流中的一张卡（坑/话术/演练/认知/行动） */
export interface TopicCardView {
  /** 卡序（swiper 顺序，与专属卡的「最后一卡」区分开：专属卡不在本数组内） */
  orderNo: number;
  /** pitfall / script / quiz / cognition / action */
  type: string;
  title: string | null;
  body: string;
  /** 1 = 支持长按复制（话术卡，§9.4 长按弹 action-sheet） */
  copyable: boolean;
  /**
   * 演练卡选项（含 `correct` 与 `explain`）
   *
   * 为什么把答案与解析一起下发（而不是选完再请求）：§9.4 要求「点选后**立即**显示 ✔/✘ + 解析条」，
   *   二次请求会引入网络等待；这些卡是静态内容，答案本身不是秘密（无排名、无奖励）。
   * 非演练卡为 null。
   */
  options: TopicCardOption[] | null;
}

/**
 * 专属卡对外状态（ADR-008 附带决策 3、§九风险表）
 *
 * ⚠️ 刻意**不下发** `status` 与降级原因：§九要求「降级时端上仍展示卡片（不显示生成失败），
 *   避免用户感到被降级对待」——降级内容与模型内容在端上长一个样，只有 `ready` 与否。
 */
export interface ExclusiveCardView {
  /** 是否已解锁本议题包；false 时端上显示锁形占位与价格（§9.4） */
  locked: boolean;
  /** 解锁价格（元，后端唯一可信金额 E4）；已解锁为 null。P1 全免费为 0 */
  price: number | null;
  /** 是否已有可展示内容（含降级内容）；false 且未锁定时端上显示「生成你们的专属版本」 */
  ready: boolean;
  content: string | null;
  /** 生成时间（ISO 8601）；未生成为 null */
  generatedAt: string | null;
}

/** 议题列表项（GET /api/v1/topics） */
export interface TopicListItem {
  code: string;
  title: string;
  subtitle: string | null;
  /** 是否已解锁（P1 通过免费订单领取权益，见 ADR-007 决策 1） */
  unlocked: boolean;
  /** 续看位置（0 = 未读过） */
  lastOrderNo: number;
  /** 是否已「学会」打卡 */
  finished: boolean;
  /**
   * 挂载维度编码（ADR-007 附带决策 4）
   *
   * 为什么列表也要下发：报告页「待沟通区」要按维度反查议题包入口（规范增补一 §三
   *   「报告中每个待沟通区 → 对应议题包入口」）。不下发就只能逐个议题调详情接口
   *   （N+1 往返），或把「维度 → 议题」映射抄进端上（违反 P5 单一真源）。
   */
  mountDimensions: string[];
}

/** 议题详情 / 卡片流（GET /api/v1/topics/:code） */
export interface TopicDetailView {
  code: string;
  title: string;
  subtitle: string | null;
  /**
   * 挂载维度编码（ADR-007 附带决策 4）
   * 报告「待沟通区」按维度反查议题包入口，端上据此在报告页挂入口
   */
  mountDimensions: string[];
  /** 卡片流（不含专属卡，专属卡是最后一卡，见 exclusiveCard） */
  cards: TopicCardView[];
  progress: TopicProgressView;
  /** 最后一卡：AI 专属卡 */
  exclusiveCard: ExclusiveCardView;
}

/** 阅读进度（§9.4 续看） */
export interface TopicProgressView {
  /** 上次停留的卡序（0 = 未读过） */
  lastOrderNo: number;
  finished: boolean;
}

/** 进度上报结果（回传落库后的值：端上据此纠正本地缓存） */
export interface TopicProgressAck extends TopicProgressView {
  code: string;
}
