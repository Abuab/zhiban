/**
 * 邀请域常量（模块 5）
 *
 * 规格依据（全部为规格原文取值，禁止在业务代码里再出现字面量）：
 * - PRD-002 §3 状态机、§5 边界与异常、§4 R8 知情同意原文
 * - 边界总表 C1/C3/C4/C5/C7/C8/C9/C10
 * - docs/adr/ADR-005.md 决策 6（提醒未送达不计数）/ 决策 7（「进行中」定义）
 */

/** 邀请状态（与 invite.status 取值一致） */
export const INVITE_STATUS = {
  CREATED: 'invite_created',
  OPENED: 'invite_opened',
  CONSENT_GIVEN: 'consent_given',
  ANSWERING: 'answering',
  COMPLETED: 'completed',
  REPORT_UNLOCKED: 'report_unlocked',
  EXPIRED: 'expired',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
} as const;

/**
 * 「进行中」状态集合（ADR-005 决策 7）
 * 用途：① 创建前置校验（同一发起方同时最多 1 个进行中邀请，PRD-002 §5 防囤积）
 *       ② 过期扫描范围
 * 终态（report_unlocked / expired / declined / cancelled）不占额度 → 历史报告永久可回看。
 */
export const ACTIVE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
  INVITE_STATUS.COMPLETED,
];

/** 已进入答题及以后的状态（再次打开不再重复写 opened_at 与状态） */
export const ANSWERED_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
  INVITE_STATUS.COMPLETED,
  INVITE_STATUS.REPORT_UNLOCKED,
];

/**
 * 可过期的状态集合（C4：30 天未 completed → expired）
 *
 * 与 `ACTIVE_INVITE_STATUSES` 的唯一差别是**排除 completed**：
 * completed 意味着双方快照已齐备、报告正在（或已经）生成，此时若因超期被置 expired，
 * 会把「报告已生成但没人看过」的历史邀请标成过期，且与 report_unlocked 互相矛盾。
 * 过期扫描与懒判定共用本集合，保证两处口径一致。
 */
export const EXPIRABLE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
];

/**
 * 可提醒的状态集合（PRD-002 §5「对方不答：发起方仅见状态与提醒 TA」/ C9）
 *
 * 取值与 `EXPIRABLE_INVITE_STATUSES` 相同（都是「被邀请方尚未交卷」），
 * 但语义不同（一个管「能否催」、一个管「是否过期」），故独立命名：
 * 将来若调整其中一条规则，另一条不应被连带改动。
 */
export const REMINDABLE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
];

/** 邀请有效期：30 天（C4 / PRD-002 §3 异常分支） */
export const INVITE_EXPIRE_DAYS = 30;

/** 续期时长：7 天（C4「可续期 7 天一次」） */
export const INVITE_RENEW_DAYS = 7;

/** 续期次数上限（C4：限 1 次） */
export const INVITE_RENEW_MAX = 1;

/** 提醒次数上限（PRD-002 §5：每邀请限 3 次） */
export const INVITE_REMIND_MAX = 3;

/** 换人次数上限（C7：同一被拒绝的邀请最多派生 1 条新邀请） */
export const INVITE_REPLACEMENT_MAX = 1;

/** 邀请码随机字节数：128 位（C8）→ 32 位十六进制字符串 */
export const INVITE_CODE_BYTES = 16;

/** 邀请码格式（32 位小写十六进制），用于入参格式校验，避免拿任意串去打库 */
export const INVITE_CODE_PATTERN = /^[0-9a-f]{32}$/;

/** 发起方连续创建邀请的最小间隔（秒）：防「删了再建」刷邀请码 */
export const INVITE_CREATE_COOLDOWN_SEC = 10;

/**
 * 知情同意文案（R8 原文，逐字一致，禁止改写）
 * 前端展示与服务端留痕（consent_given 时的 audit_log）用同一常量，避免两处漂移。
 */
export const INVITE_CONSENT_TEXT =
  '你们的答案将共同生成一份关系分析；详细分析由发起人持有，你可见基础摘要。';

/** 被邀请方不是首个打开者时的提示（C1：不泄露任何答题数据与发起方信息） */
export const INVITE_ALREADY_ACCEPTED_MESSAGE = '该邀请已被接受';

/** 昵称为空时的兜底展示名（不在任何地方落库，仅渲染时使用） */
export const NICKNAME_FALLBACK = {
  INITIATOR: '发起方',
  INVITEE: 'TA',
} as const;

/**
 * 报告生成 job 的业务幂等键前缀（jobId = `report-<inviteId>`，ADR-005 决策 4）
 *
 * ⚠️ 分隔符用 `-` 而非 ADR-005 原写的 `:`：BullMQ 对自定义 jobId 有硬校验
 *    （`Custom Id cannot contain :`，见 bullmq/classes/job.js），用冒号会在 add() 时抛错。
 *    幂等语义不变（同一邀请恒映射同一 jobId），故属实现细节修正而非架构变更。
 */
export const REPORT_JOB_ID_PREFIX = 'report-';

/** 提醒（订阅消息）未配置模板时的业务提示（ADR-005 决策 6：不消耗次数） */
export const REMIND_TEMPLATE_MISSING_MESSAGE = '提醒功能暂未开通，请稍后再试';

/**
 * 被邀请方没有可复用的历史单人答卷时的提示（C3 边界）
 * 与「复用开关关闭」区分：开关关闭属发起方设置，无历史答卷属用户自身状态，出口文案不同。
 */
export const INVITE_NO_REUSABLE_SHEET_MESSAGE = '没有可复用的历史答案，直接作答即可';

/** 对比报告生成中（R6：前端轮询期间展示） */
export const INVITE_REPORT_PENDING_MESSAGE = '报告生成中，稍后下拉刷新即可查看';

/** 对比报告生成失败（D1：已转人工工单，用户无需重试操作） */
export const INVITE_REPORT_FAILED_MESSAGE = '报告生成遇到问题，我们已记录并会尽快处理';

/** 双人报告模板缺失（未执行 npm run report:seed，属部署事故） */
export const DOUBLE_REPORT_TEMPLATE_MISSING_MESSAGE = '报告文案模板缺失，请联系客服';

/** 快照角色（与 answer_snapshot.role 取值一致） */
export const SNAPSHOT_ROLE_INITIATOR = 'initiator';
export const SNAPSHOT_ROLE_INVITEE = 'invitee';

/** 报告生成所需的快照数（发起方 + 被邀请方各一份，R6「双方齐备」） */
export const REQUIRED_SNAPSHOT_COUNT = 2;

/** 邀请码写入的唯一键冲突重试次数（32 位十六进制随机码，冲突概率极低；重试只为兜底） */
export const INVITE_CODE_MAX_ATTEMPTS = 5;

/** 我的邀请列表上限（历史报告永久可回看，列表按 id 倒序取最近若干条） */
export const INVITE_LIST_LIMIT = 20;

/**
 * 创建邀请的冷却键前缀（防「取消后立刻重建」刷邀请码，C8）
 * 与 RateLimitGuard 的接口级限流互补：限流管「频率」，冷却管「同一时刻只有一个创建在飞」。
 */
export const INVITE_CREATE_COOLDOWN_PREFIX = 'invite:create:';

/**
 * 提醒订阅消息的字段键
 *
 * 说明（宪法 P5 边界）：订阅模板的**文案与字段键**由运营在微信公众平台创建时生成，
 * 属**结构性标识**（thing1 / time2 之类），不是本项目的可见文案，
 * 故以常量集中登记；模板 ID 走 `WX_SUBSCRIBE_TEMPLATE_INVITE` 配置，跳转页走 `WX_SUBSCRIBE_INVITE_PAGE` 配置。
 * 运营建好模板后若字段键不同，只改这一处（并同步 report/api 文档），无需改业务代码。
 */
export const REMIND_TEMPLATE_FIELDS = {
  /** 邀请人昵称（微信侧模板字段类型 thing） */
  INVITER: 'thing1',
  /** 提醒时间（微信侧模板字段类型 time） */
  TIME: 'time2',
} as const;

/**
 * 分享长图水印的命名空间（D3：水印串 = user_id 哈希，端上只负责绘制、不可伪造）
 * 加命名空间前缀是为了避免与其它系统的同类哈希碰撞，不承担任何权限判定职责。
 */
export const SHARE_WATERMARK_NAMESPACE = 'zhiban:share:';

/** 水印串长度（十六进制字符数） */
export const SHARE_WATERMARK_LENGTH = 8;
