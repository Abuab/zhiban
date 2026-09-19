import { DIMENSION_CODES } from '../../engines/scale/scale.constants.js';

/**
 * 内容域常量（模块 7，ADR-007）
 *
 * 规格依据：《锦囊卡片流 v1.0》8 议题 + 增补 v0.3（微内容标准 + AI 专属卡）；
 *   卡片类型与落库值见 docs/schema.sql `topic_card.type` 注释。
 */

/** 议题编码（ADR-007 附带决策 1：语义化 snake_case；原文档示例 `licai` 属残留，与实际议题不对应） */
export const TOPIC_CODES = {
  BETROTHAL_GIFT: 'betrothal_gift',
  MONEY: 'money',
  CHORES: 'chores',
  SECOND_CHILD: 'second_child',
  IN_LAW_BOUNDARY: 'in_law_boundary',
  COLD_WAR: 'cold_war',
  LONG_DISTANCE: 'long_distance',
  MEET_PARENTS: 'meet_parents',
} as const;

export type TopicCode = (typeof TOPIC_CODES)[keyof typeof TOPIC_CODES];

/**
 * 议题元数据（编码 / 标题 / 排序 / 挂载维度）
 *
 * 为什么把元数据放在常量而不是只放种子数据里：
 *   商品域要为每个议题建一行 `product`（`topic_single:<code>`，ADR-007 附带决策 7），
 *   若议题编码与标题只在种子数据里，商品种子就得抄一份 —— 两处一旦不同步，
 *   就会出现「商品指向一个不存在的议题」这种查不出来的错。
 *   故本文件是议题编码与标题的**唯一真源**；卡片正文（体积大、纯内容）仍放种子数据。
 *
 * `mountDimensions`（ADR-007 附带决策 4）：报告「待沟通区」按维度反查议题包入口。
 *   映射依据是各议题与量表维度的语义对应（见《婚前准备评估》维度定义），
 *   一个议题可挂多维度（如「异地安排」同时涉及职业规划与亲密关系）。
 */
export interface TopicMeta {
  code: TopicCode;
  /** 议题名（列表/导航展示） */
  title: string;
  /** 一句话钩子（卡片流首屏与列表副标题） */
  subtitle: string;
  /** 列表排序（从 0 起，与《锦囊卡片流 v1.0》的议题 01-08 顺序一致） */
  orderNo: number;
  mountDimensions: string[];
}

export const TOPICS: readonly TopicMeta[] = [
  {
    code: TOPIC_CODES.BETROTHAL_GIFT,
    title: '彩礼',
    subtitle: '行情是地板，结构才是谈判桌',
    orderNo: 0,
    mountDimensions: [DIMENSION_CODES.FINANCE],
  },
  {
    code: TOPIC_CODES.MONEY,
    title: '管钱',
    subtitle: '婚前不交底，婚后全是雷',
    orderNo: 1,
    mountDimensions: [DIMENSION_CODES.FINANCE],
  },
  {
    code: TOPIC_CODES.CHORES,
    title: '家务分工',
    subtitle: '自觉是最不靠谱的分工方式',
    orderNo: 2,
    mountDimensions: [DIMENSION_CODES.CHORES],
  },
  {
    code: TOPIC_CODES.SECOND_CHILD,
    title: '二胎分歧',
    subtitle: '别吵立场，算账',
    orderNo: 3,
    mountDimensions: [DIMENSION_CODES.PARENTING],
  },
  {
    code: TOPIC_CODES.IN_LAW_BOUNDARY,
    title: '婆媳边界',
    subtitle: '谁的父母谁去说',
    orderNo: 4,
    mountDimensions: [DIMENSION_CODES.FAMILY_BOUNDARY],
  },
  {
    code: TOPIC_CODES.COLD_WAR,
    title: '冷战修复',
    subtitle: '暂停可以，停战要有期限',
    orderNo: 5,
    mountDimensions: [DIMENSION_CODES.COMMUNICATION],
  },
  {
    code: TOPIC_CODES.LONG_DISTANCE,
    title: '异地安排',
    subtitle: '拖到婚前才谈，是最差时机',
    orderNo: 6,
    mountDimensions: [DIMENSION_CODES.CAREER, DIMENSION_CODES.INTIMACY],
  },
  {
    code: TOPIC_CODES.MEET_PARENTS,
    title: '见家长',
    subtitle: '情报先行，表现其次',
    orderNo: 7,
    mountDimensions: [DIMENSION_CODES.FAMILY_BOUNDARY, DIMENSION_CODES.COMMUNICATION],
  },
];

/** topic.status */
export const TOPIC_STATUS_ON = 'on';
export const TOPIC_STATUS_OFF = 'off';

/**
 * 卡片流卡序上限（进度上报的入参上界）
 * 为什么要有上界：`topic_read_progress.last_order_no` 是端上报的，脏数据（如 999999）
 *   会让「续看」直接跳到末页、用户以为卡全读完了；当前每议题最多 9 张卡，200 足够宽松。
 */
export const TOPIC_CARD_MAX_ORDER_NO = 200;

/** topic_card.type（`exclusive` 由 exclusive_card 表承载，不落 topic_card，见 ADR-007 附带决策 2） */
export const CARD_TYPE_PITFALL = 'pitfall';
export const CARD_TYPE_SCRIPT = 'script';
export const CARD_TYPE_QUIZ = 'quiz';
export const CARD_TYPE_COGNITION = 'cognition';
export const CARD_TYPE_ACTION = 'action';

/**
 * 卡片类型白名单（CMS 可写入的 5 类）
 * 后台校验与种子数据共用，避免「后台允许写、端上不认识」的类型流进库。
 */
export const TOPIC_CARD_TYPES: readonly string[] = [
  CARD_TYPE_PITFALL,
  CARD_TYPE_SCRIPT,
  CARD_TYPE_QUIZ,
  CARD_TYPE_COGNITION,
  CARD_TYPE_ACTION,
];

/** 单卡正文上限（增补 v0.3 一「每张卡只承担一个功能，≤120 字」） */
export const TOPIC_CARD_BODY_MAX_LENGTH = 120;

/** 仅话术卡可长按复制（§9.4：长按弹「复制」action-sheet） */
export const CARD_TYPE_COPYABLE = CARD_TYPE_SCRIPT;

/** exclusive_card.status */
export const EXCLUSIVE_CARD_STATUS_READY = 'ready';
/** 降级为通用版（模型未配置 / 超时 / 禁词校验连续失败） */
export const EXCLUSIVE_CARD_STATUS_DEGRADED = 'degraded';
/** 降级且**无任何内容可展示**（议题连认知卡/行动卡都没有，实际种子数据下不可达，仅作兜底） */
export const EXCLUSIVE_CARD_STATUS_REJECTED = 'rejected';
/**
 * 说明：`exclusive_card.status` 在 schema 里的默认值是 `pending`，但**代码不会写入该值** ——
 * 生成是同步请求（用户在端上看骨架屏等待），并发由 Redis 锁（`EXCLUSIVE_CARD_LOCK_PREFIX`）表达，
 * 不需要一行「生成中」台账。占位行一旦因进程崩溃残留，反而会把用户永久卡在「生成中」。
 */

/** prompt 模板版本（ADR-007 决策 4：双人版 / 单人版共用同一接口与缓存） */
export const PROMPT_VERSION_DUO = 'premium-v1-duo';
export const PROMPT_VERSION_SOLO = 'premium-v1-solo';

/** 敏感词校验 scope（专属卡与昵称的词表相互隔离，见 SensitiveWordService） */
export const SENSITIVE_SCOPE_EXCLUSIVE_CARD = 'exclusive_card';

/**
 * 专属卡生成并发锁（ADR-008 附带决策 9：同一归属同一议题至多调 2 次模型）
 * TTL 必须大于模型超时（20s），否则锁先过期会导致重复调用；进程崩溃后最多锁 60s。
 */
export const EXCLUSIVE_CARD_LOCK_PREFIX = 'topic:exclusive_card_lock:';
export const EXCLUSIVE_CARD_LOCK_TTL_SEC = 60;

/**
 * 单人版专属卡在 `exclusive_card.invite_id` 上的哨兵值（ADR-008 决策 5）
 * 单人场景没有邀请，用 0 占位；**归属靠 `owner_uid` 区分**，不会与他人串卡。
 */
export const EXCLUSIVE_CARD_SOLO_INVITE_ID = 0;

/** 每次生成最多调用模型次数（首次 + 重试 1 次，ADR-008 附带决策 1） */
export const EXCLUSIVE_CARD_MAX_ATTEMPTS = 2;

/** 降级原因（写 `check_result.reason`，ADR-008 决策 4；模型原文不落库、不下发） */
export const EXCLUSIVE_CARD_REASON_LLM_UNAVAILABLE = 'llm_unavailable';
export const EXCLUSIVE_CARD_REASON_NO_DIMENSION_DATA = 'no_dimension_data';
export const EXCLUSIVE_CARD_REASON_MODEL_ERROR = 'model_error';
export const EXCLUSIVE_CARD_REASON_SENSITIVE_REJECTED = 'sensitive_rejected';

/**
 * 专属卡 prompt 的【系统角色】段（《锦囊卡片流 v1.0》§9.2 原文逐字）
 *
 * 为什么放常量而不是 prompt 文件里：双人版与单人版**共用同一段系统角色**
 *   （ADR-007 决策 4「降级为单人版不等于降低合规要求」），放其中一版再由另一版 import
 *   会让两版产生无意义的依赖关系。
 * 改这里的文案等于改 prompt 版本，需同步 `PROMPT_VERSION_*` 并重跑专属卡单测。
 */
export const EXCLUSIVE_CARD_SYSTEM_ROLE = `【系统角色】
你是婚姻家庭沟通教练。风格：口语化、温暖、不说教。立场绝对中立，
同时照顾关系双方。遵守铁律：不评判谁对谁错；不出现"不合适/劝分/风险"等
否定判词；不提供法律意见；不制造焦虑。`;
