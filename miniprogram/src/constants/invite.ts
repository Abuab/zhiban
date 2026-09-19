/**
 * 邀请与对比报告域前端常量（模块 5）
 *
 * 原则（同 constants/assessment.ts）：只放**结构性常量与规格已固定的文案**；
 *   随运营变化的文案一律由服务端下发 —— 知情同意原文（R8）走 `consentText`、
 *   报告正文走 `blocks`、报告生成中/失败提示走 `message`、差值档位名走 `levelLabel`。
 *
 * 规格依据：PRD-002 §3 状态机 / §4 R3-R8、规范增补 v0.2 §3.1、docs/adr/ADR-005.md
 */

/** 邀请状态取值（与服务端 INVITE_STATUS 同源，避免业务代码出现裸字符串） */
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
 * 状态展示名（列表与详情页的同一套文案）
 *
 * 措辞刻意**不区分视角**（不写「待对方作答」）：同一状态在发起方 / 被邀请方的列表里都会出现，
 * 按角色拆两套会让文案表膨胀且容易漏；此处按「这件事现在到哪一步」客观描述。
 */
export const INVITE_STATUS_LABELS: Record<string, string> = {
  [INVITE_STATUS.CREATED]: '已发出邀请',
  [INVITE_STATUS.OPENED]: '对方已打开',
  [INVITE_STATUS.CONSENT_GIVEN]: '等待作答',
  [INVITE_STATUS.ANSWERING]: '作答中',
  [INVITE_STATUS.COMPLETED]: '报告生成中',
  [INVITE_STATUS.REPORT_UNLOCKED]: '报告已就绪',
  [INVITE_STATUS.EXPIRED]: '已过期',
  [INVITE_STATUS.DECLINED]: '对方未同意',
  [INVITE_STATUS.CANCELLED]: '已取消',
};

/** 状态兜底展示名（服务端新增状态而端上未同步时的降级，不显示英文枚举） */
export const INVITE_STATUS_FALLBACK_LABEL = '状态未知';

/**
 * 「进行中」状态集合（与服务端 ACTIVE_INVITE_STATUSES 同源，ADR-005 决策 7）
 * 端上用途：
 *   ① 列表 / 首页判断「是否已有进行中的邀请」——有则不展示「发起邀请」按钮（防囤积，PRD-002 §5）
 *   ② 详情页判断能否取消 / 提醒
 * 终态（report_unlocked / expired / declined / cancelled）不占额度，历史报告永久可回看。
 */
export const ACTIVE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
  INVITE_STATUS.COMPLETED,
];

/** 被邀请方已进入答题阶段（据此决定「继续作答」还是「去同意」） */
export const ANSWERED_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
  INVITE_STATUS.COMPLETED,
  INVITE_STATUS.REPORT_UNLOCKED,
];

/**
 * 可提醒的状态（与服务端 REMINDABLE_INVITE_STATUSES 同源）
 * 语义：对方尚未交卷才谈得上「催」；服务端还会额外要求对方已绑定（对方没打开过时提醒没有收件人）
 */
export const REMINDABLE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
];

/**
 * 可续期的状态（与服务端 EXPIRABLE_INVITE_STATUSES + expired 同源，C4）
 * 规格把续期写在 `expired` 分支下，服务端实现允许**未过期时顺延**，故两者都要出现续期入口。
 */
export const RENEWABLE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
  INVITE_STATUS.EXPIRED,
];

/**
 * 端上允许「取消邀请」的状态集合
 *
 * ⚠️ 刻意比服务端的 `ACTIVE_INVITE_STATUSES` 更窄：**不含 `completed`**。
 * 服务端把 `completed` 视为进行中（它影响「同时最多 1 个进行中邀请」的额度判定），
 * 但在 `completed` 且报告尚未生成时取消，会把正在生成的报告变成孤儿（api.md §13.12 的设计意图）。
 * 端上先于服务端收紧：不展示入口即不可能触发；此差异已在模块 5 交付报告中登记。
 */
export const CANCELLABLE_INVITE_STATUSES: readonly string[] = [
  INVITE_STATUS.CREATED,
  INVITE_STATUS.OPENED,
  INVITE_STATUS.CONSENT_GIVEN,
  INVITE_STATUS.ANSWERING,
];

/** 邀请中的角色（与服务端 InviteRole 一致） */
export const INVITE_ROLE = {
  INITIATOR: 'initiator',
  INVITEE: 'invitee',
} as const;

/** 角色展示名（「我的邀请」列表标签） */
export const INVITE_ROLE_LABELS: Record<string, string> = {
  [INVITE_ROLE.INITIATOR]: '我发起的',
  [INVITE_ROLE.INVITEE]: '我参与的',
};

/** 报告层级（R3 三层可见，端上只做展示分支，层级由服务端按角色决定） */
export const REPORT_LEVEL = {
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
} as const;

/** 报告生成状态（D1 / R6） */
export const REPORT_STATUS = {
  PENDING: 'pending',
  READY: 'ready',
  FAILED: 'failed',
} as const;

/**
 * 双人报告区块键（与服务端 DOUBLE_BLOCK 同源）
 * 维度解读块的 block_key 直接用维度编码；L3 的标题/共识/结尾三块由服务端固定（见 §13.14）。
 */
export const DOUBLE_BLOCK = {
  INTRO: 'INTRO',
  RADAR: 'RADAR',
  PENDING: 'PENDING',
  DIVERGENCE: 'DIVERGENCE',
  UNEVALUATED: 'UNEVALUATED',
  CONSENSUS: 'CONSENSUS',
  BASELINE_NOTICE: 'BASELINE_NOTICE',
  QUALITY_NOTICE: 'QUALITY_NOTICE',
  TALK_GUIDE: 'TALK_GUIDE',
  ENDING: 'ENDING',
  MEMORY_CARD: 'MEMORY_CARD',
  TALK_ENTRY: 'TALK_ENTRY',
} as const;

/**
 * L3 分享长图区块键（与服务端 DOUBLE_BLOCK 的 SHARE_* 同源）
 * 服务端已保证这三块不含任何分数 / 差值 / 分歧 / 档位（禁用键 fail-closed），端上只负责绘制。
 */
export const SHARE_BLOCK = {
  TITLE: 'SHARE_TITLE',
  CONSENSUS: 'SHARE_CONSENSUS',
  ENDING: 'SHARE_ENDING',
} as const;

/**
 * 分享长图绘制参数（端上 canvas 合成，ADR-005 决策 4）
 * 单位均为逻辑像素（绘制前按 dpr 缩放画布），宽度取 750 以对齐设计稿栅格。
 */
export const SHARE_IMAGE = {
  WIDTH: 750,
  PADDING: 48,
  /** 画布高度上限（超出即内容异常，避免生成超大图导致保存失败） */
  MAX_HEIGHT: 4000,
  BACKGROUND: '#FAF6F2',
} as const;

/** 邀请码长度（32 位小写十六进制，C8：128 位随机） */
export const INVITE_CODE_LENGTH = 32;

/**
 * 邀请码格式（与服务端 INVITE_CODE_PATTERN 一致）
 * 端上先做格式校验再发请求：分享路径的 code 参数可能被改写，提前拦掉可省一次必然 404 的往返。
 */
export const INVITE_CODE_PATTERN = /^[0-9a-f]{32}$/;

/**
 * 邀请域页面路径（分享卡片 path、页面间跳转、登录回跳共用一处登记）
 * 集中在此的原因：路径一旦写散，改目录时必漏；且分享卡片 path 与 pages.json 必须一字不差。
 */
export const INVITE_ACCEPT_PAGE_PATH = '/pages/invite/accept';
export const INVITE_DETAIL_PAGE_PATH = '/pages/invite/detail';
export const INVITE_LIST_PAGE_PATH = '/pages/invite/index';
/** 对比报告页（L1 发起方 / L2 被邀请方） */
export const DOUBLE_REPORT_PAGE_PATH = '/pages/report/double';
/** L3 分享长图页（端上 canvas 合成，ADR-005 决策 4） */
export const SHARE_IMAGE_PAGE_PATH = '/pages/report/share';

/**
 * 报告生成中时的轮询间隔与次数（R6：正常 ≤10 秒，前端轮询）
 * 2s × 15 次 ≈ 30s；超出后不再自动轮询，改为提示用户下拉刷新（避免长时间打满请求）。
 */
export const REPORT_POLL_INTERVAL_MS = 2000;
export const REPORT_POLL_MAX_ATTEMPTS = 15;
