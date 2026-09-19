import type {
  DoubleReportL1View,
  DoubleReportL2View,
  DoubleReportL3Material,
  DoubleReportPendingView,
  ReportStatus,
  StoredDimensionScores,
  StoredFlaggedItems,
} from '../report/report.types.js';
import type { InviteStatus } from './entities/invite.entity.js';

/**
 * 邀请域领域类型（模块 5）
 *
 * 只描述**对外结构**，不 import 数据库实体以外的实现细节。
 * 规格依据：
 * - PRD-002 §3 状态机 / §5 边界与异常 / §7 接口清单
 * - 规范增补 v0.2 §3.1 三层可见模型（发起方 L1 / 被邀请方 L2 / 分享版 L3）
 * - docs/adr/ADR-005.md 决策 1（越权统一 10002）/ 决策 6（提醒未送达不计数）/ 决策 7（进行中定义）
 *
 * 视角分离：发起方与被邀请方看到的东西**结构性不同**（发起方有提醒/续期/换人，被邀请方有同意书/复用），
 * 故用判别联合（role 字段）而不是「一个大对象 + 可选字段」，让「被邀请方不可能拿到提醒次数」由类型保证。
 */

/** 访问者在邀请中的角色 */
export type InviteRole = 'initiator' | 'invitee';

/**
 * 请求来源（同意留证 `consent_log` 与删除留痕 `audit_log` 用）
 * 由 controller 用 `resolveClientIp(request)` 与 `user-agent` 现场构造，
 * 与 `topic.controller.ts` 的既有口径一致（不采信不可信来源的 X-Forwarded-For）。
 */
export interface InviteRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** 创建邀请的返回（PRD-002 §7 POST /invites） */
export interface InviteCreateResult {
  inviteId: number;
  /** 邀请码（128 位随机，32 位十六进制）；分享卡片 path 由端上拼接，服务端不下发 H5 链接 */
  code: string;
  status: InviteStatus;
  scaleVersionId: number;
  scaleVersion: string;
  /** 过期时间（ISO 8601） */
  expireAt: string;
  createdAt: string;
  /** 换人重邀时指向被拒绝的原邀请（C7）；首次创建为 null */
  replacedFromInviteId: number | null;
}

/** 发起方视角（含提醒/续期/换人额度，不含知情同意书） */
export interface InviteInitiatorView {
  inviteId: number;
  code: string;
  role: 'initiator';
  status: InviteStatus;
  scaleVersion: string;
  createdAt: string;
  expireAt: string;
  completedAt: string | null;
  /** 被邀请方是否已绑定（C1：未绑定时对方还没打开过） */
  inviteeBound: boolean;
  inviteeNickname: string | null;
  /** 剩余提醒次数（PRD-002 §5：每邀请限 3 次） */
  remindRemaining: number;
  /**
   * 提醒订阅消息模板 id（端上 `wx.requestSubscribeMessage` 需要；未配置为 null）
   * 由服务端下发而不是端上写死：模板由运营在微信公众平台创建，id 属部署配置（宪法 P5）。
   */
  remindTemplateId: string | null;
  /** 剩余续期次数（C4：限 1 次） */
  renewRemaining: number;
  /** 是否可换人重邀（C7：仅 declined 且未派生过新邀请时可） */
  canReplace: boolean;
  reportStatus: ReportStatus | null;
}

/** 被邀请方视角（含知情同意书与复用选项，不含任何发起方额度信息） */
export interface InviteInviteeView {
  inviteId: number;
  code: string;
  role: 'invitee';
  status: InviteStatus;
  scaleVersion: string;
  /** 过期时间（ISO 8601） */
  expireAt: string;
  /** 知情同意书原文（R8 逐字一致，取自服务端常量，端上不硬编码） */
  consentText: string;
  /** 是否已同意（status 已过 consent_given） */
  consentGiven: boolean;
  /**
   * 提醒订阅消息模板 id（被邀请方在同意页一次性订阅，同意后发起方才能提醒到 TA）
   * 与发起方视角同源；未配置为 null（此时端上不弹订阅授权，提醒功能属未开通）
   */
  remindTemplateId: string | null;
  initiatorNickname: string | null;
  /** 是否可复用历史单人答案（C3/R7） */
  reuse: {
    /** 本邀请是否允许复用（invite.reuse_allowed） */
    allowed: boolean;
    /** 是否存在可复用的同版本单人答卷 */
    available: boolean;
    sheetId: number | null;
    submittedAt: string | null;
  };
  /** 已创建的邀请答卷 id（null = 尚未开始作答） */
  sheetId: number | null;
  reportStatus: ReportStatus | null;
}

/** 邀请详情（按访问者角色返回不同结构） */
export type InviteView = InviteInitiatorView | InviteInviteeView;

/** 提醒结果（ADR-005 决策 6：未送达不消耗次数，故必须回传剩余额度） */
export interface InviteRemindResult {
  inviteId: number;
  remindCount: number;
  remindRemaining: number;
  remindAt: string;
}

/**
 * 报告生成 job 载荷（队列 `report-generate`）
 * 只放 inviteId：报告所需的全部数据（双方快照 / 量表版本 / 模板）都在 worker 内按 id 现查，
 * 避免把大对象塞进 Redis 队列，也避免「入队时的数据」与「执行时的数据」不一致。
 */
export interface ReportGenerateJob {
  inviteId: number;
}

/** 交卷 / 复用后的应答（R6：端上据 reportStatus 轮询） */
export interface InviteProgressAck {
  inviteId: number;
  status: InviteStatus;
  reportStatus: ReportStatus | null;
  /** 双方快照是否齐备（false = 还在等对方） */
  bothCompleted: boolean;
}

/** 我的邀请列表项（历史报告永久可回看，PRD-002 §5） */
export interface InviteListItem {
  inviteId: number;
  code: string;
  role: InviteRole;
  status: InviteStatus;
  scaleVersion: string;
  /** 对方昵称（发起方视角=被邀请方，被邀请方视角=发起方；未绑定为 null） */
  counterpartNickname: string | null;
  createdAt: string;
  expireAt: string;
  completedAt: string | null;
  reportStatus: ReportStatus | null;
  /** 报告可读时为报告 id（端上据此调 L3 素材接口） */
  reportId: number | null;
}

/**
 * 报告读取结果（R6：未生成完成时返回 pending/failed 供端上轮询）
 * - status='ready' 时按访问者角色给 L1（发起方）或 L2（被邀请方）
 * - status='pending'/'failed' 时给 DoubleReportPendingView
 */
export type InviteReportView =
  | DoubleReportPendingView
  | DoubleReportL1View
  | DoubleReportL2View;

export type { DoubleReportL3Material };

/**
 * 「报告已就绪的双人测评」取数结构（模块 7 专属卡双人版 prompt 输入，ADR-008 决策 5）
 *
 * 为什么由邀请域提供而不让内容域直接读 report 表：
 *   `owner_uid` 必须取**发起方**（同一邀请只生成一张卡、双方共享），
 *   而「谁是发起方」是邀请域的语义；内容域若自行拼 invite + report 两张表，
 *   就等于把邀请模型的细节复制一份到内容域，后续改邀请结构必漏改。
 *
 * 只暴露专属卡所需的字段：维度分（选维度）、逐题分歧（选分歧题）。
 * diff 分级、共识区、底线提示等报告结论与专属卡无关，不下发。
 */
export interface ReadyDoubleReportSource {
  inviteId: number;
  /** 邀请发起方 uid（= 专属卡缓存归属 `owner_uid`，ADR-008 决策 5） */
  initiatorUid: number;
  /** 被邀请方 uid（prompt 的乙方） */
  inviteeUid: number;
  scaleVersionId: number;
  /** `report.dimension_scores_json`：双方各维度分 + 未评估维度 */
  dimensionScores: StoredDimensionScores;
  /** `report.flagged_items_json`：取 `scale` 里所选维度分差最大的那道题 */
  flagged: StoredFlaggedItems;
}
