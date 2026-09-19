/**
 * 邀请与对比报告域接口类型（模块 5，镜像服务端）
 * 唯一真源：server/src/modules/invite/invite.types.ts + server/src/modules/report/report.types.ts（改动需两端同步）
 * 契约文档：docs/api.md §13
 *
 * 规格依据：PRD-002（状态机 / R1-R8 / §7 接口清单）、规范增补 v0.2 §3.1（三层可见）、
 *          docs/adr/ADR-005.md 决策 1（越权统一 10002）/ 决策 6（提醒未送达不计数）
 */
import type { RenderedBlock } from './api';
import type {
  AssessmentDetail,
  SaveAnswersInput,
  SheetState,
  SubmitAssessmentInput,
} from './assessment';

/** 邀请状态（与 invite.status 取值一致） */
export type InviteStatus =
  | 'invite_created'
  | 'invite_opened'
  | 'consent_given'
  | 'answering'
  | 'completed'
  | 'report_unlocked'
  | 'expired'
  | 'declined'
  | 'cancelled';

/** 访问者在邀请中的角色 */
export type InviteRole = 'initiator' | 'invitee';

/** 报告生成状态（未生成过为 null） */
export type ReportStatus = 'pending' | 'ready' | 'failed';

/** 报告层级：L1 发起方完整版 / L2 被邀请方基础版 / L3 分享版 */
export type ReportLevel = 'L1' | 'L2' | 'L3';

/** 维度差值档位（阈值取自服务端 scoring_rule，端上不判定） */
export type GapLevel = 'high' | 'mid' | 'low';

/** 创建邀请的返回 */
export interface InviteCreateResult {
  inviteId: number;
  /** 邀请码（32 位十六进制）；分享卡片 path 由端上拼接 */
  code: string;
  status: InviteStatus;
  scaleVersionId: number;
  scaleVersion: string;
  expireAt: string;
  createdAt: string;
  /** 换人重邀时指向被拒绝的原邀请（C7）；首次创建为 null */
  replacedFromInviteId: number | null;
}

/** 发起方视角 */
export interface InviteInitiatorView {
  inviteId: number;
  code: string;
  role: 'initiator';
  status: InviteStatus;
  scaleVersion: string;
  createdAt: string;
  expireAt: string;
  completedAt: string | null;
  /** 被邀请方是否已绑定（C1：未绑定说明对方还没打开过） */
  inviteeBound: boolean;
  inviteeNickname: string | null;
  remindRemaining: number;
  /** 订阅消息模板 id（端上 requestSubscribeMessage 用；未配置为 null） */
  remindTemplateId: string | null;
  renewRemaining: number;
  /** 是否可换人重邀（C7） */
  canReplace: boolean;
  reportStatus: ReportStatus | null;
}

/** 被邀请方复用历史答案的可选项（C3 / R7） */
export interface InviteReuseOption {
  allowed: boolean;
  available: boolean;
  sheetId: number | null;
  submittedAt: string | null;
}

/** 被邀请方视角 */
export interface InviteInviteeView {
  inviteId: number;
  code: string;
  role: 'invitee';
  status: InviteStatus;
  scaleVersion: string;
  expireAt: string;
  /** 知情同意书原文（R8，服务端下发，端上不硬编码） */
  consentText: string;
  consentGiven: boolean;
  /** 订阅消息模板 id（同意页订阅提醒用；未配置为 null） */
  remindTemplateId: string | null;
  initiatorNickname: string | null;
  reuse: InviteReuseOption;
  /** 已创建的邀请答卷 id（null = 尚未开始作答） */
  sheetId: number | null;
  reportStatus: ReportStatus | null;
}

/** 邀请详情（按角色返回不同结构） */
export type InviteView = InviteInitiatorView | InviteInviteeView;

/** 提醒结果（ADR-005 决策 6：未送达不消耗次数） */
export interface InviteRemindResult {
  inviteId: number;
  remindCount: number;
  remindRemaining: number;
  remindAt: string;
}

/** 交卷 / 复用后的应答（R6：端上据 reportStatus 轮询） */
export interface InviteProgressAck {
  inviteId: number;
  status: InviteStatus;
  reportStatus: ReportStatus | null;
  bothCompleted: boolean;
}

/** 我的邀请列表项（历史报告永久可回看） */
export interface InviteListItem {
  inviteId: number;
  code: string;
  role: InviteRole;
  status: InviteStatus;
  scaleVersion: string;
  counterpartNickname: string | null;
  createdAt: string;
  expireAt: string;
  completedAt: string | null;
  reportStatus: ReportStatus | null;
  /** 报告可读时为报告 id（端上据此调 L3 素材接口） */
  reportId: number | null;
}

/** L1 维度行（雷达图 + 差值列表数据源） */
export interface DoubleDimensionRow {
  dimensionCode: string;
  dimensionName: string;
  scoreA: number;
  scoreB: number;
  gap: number;
  level: GapLevel;
  levelLabel: string;
  /** A 方该维度实际计入均分的题数（ADR-013 决策 4） */
  answeredCountA: number;
  /** B 方该维度实际计入均分的题数（口径同上） */
  answeredCountB: number;
  /** 该维度参与计分的题目定义数（分母） */
  scoredCount: number;
}

/** 逐题分歧明细（R2） */
export interface DoubleFlaggedItem {
  questionCode: string;
  questionTitle: string;
  dimensionCode: string | null;
  dimensionName: string | null;
  /** scale_gap = 量表题分差 ≥3；option_differ = 选择题选项不同 */
  kind: 'scale_gap' | 'option_differ';
  gap: number;
  scoreA: number | null;
  scoreB: number | null;
  optionLabelA: string | null;
  optionLabelB: string | null;
}

/** 共识区条目（仅正向） */
export interface DoubleConsensusItem {
  questionCode: string;
  questionTitle: string;
  optionKey: string;
  optionLabel: string;
}

/** 未评估维度（任一方拒绝授权敏感维度） */
export interface UnevaluatedDimension {
  dimensionCode: string;
  dimensionName: string;
}

/** 报告生成中 / 失败（前端据此展示并轮询，R6 / D1） */
export interface DoubleReportPendingView {
  reportId: number | null;
  level: ReportLevel;
  status: ReportStatus;
  message: string;
}

/** L1 完整版（发起方） */
export interface DoubleReportL1View {
  reportId: number;
  inviteId: number;
  level: 'L1';
  status: 'ready';
  scaleVersion: string;
  generatedAt: string;
  selfNickname: string;
  partnerNickname: string;
  dimensions: DoubleDimensionRow[];
  unevaluatedDimensions: UnevaluatedDimension[];
  consensusCodes: string[];
  pendingCodes: string[];
  divergenceItems: DoubleFlaggedItem[];
  consensusItems: DoubleConsensusItem[];
  baselineNotice: string | null;
  lowQualityNotice: string | null;
  blocks: RenderedBlock[];
  disclaimer: string;
}

/** L2 基础版（被邀请方）：纪念卡 + 共识区，无差值无分歧（R3） */
export interface DoubleReportL2View {
  reportId: number;
  inviteId: number;
  level: 'L2';
  status: 'ready';
  scaleVersion: string;
  generatedAt: string;
  selfNickname: string;
  partnerNickname: string;
  consensusItems: DoubleConsensusItem[];
  baselineNotice: string | null;
  blocks: RenderedBlock[];
  disclaimer: string;
}

/** 对比报告读取结果（未就绪返回 pending / failed） */
export type InviteReportView = DoubleReportPendingView | DoubleReportL1View | DoubleReportL2View;

/** L3 分享版长图素材（ADR-005 决策 4：服务端只下发素材，端上 canvas 合成） */
export interface DoubleReportL3Material {
  reportId: number;
  level: 'L3';
  title: string;
  nicknames: { a: string; b: string };
  /** 日期文案 YYYY-MM-DD */
  date: string;
  blocks: RenderedBlock[];
  /** 水印串（服务端计算的 user_id 哈希，端上只负责绘制，D3） */
  watermark: string;
  disclaimer: string;
}

/** 邀请域接口用到的测评域类型（统一出口，页面只 import 本文件） */
export type {
  AssessmentDetail,
  SaveAnswersInput,
  SheetState,
  SubmitAssessmentInput,
};
