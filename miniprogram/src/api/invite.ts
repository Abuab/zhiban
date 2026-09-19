import { API_VERSION_PREFIX } from '../config/env';
import type {
  AssessmentDetail,
  DoubleReportL3Material,
  InviteCreateResult,
  InviteInitiatorView,
  InviteListItem,
  InviteProgressAck,
  InviteRemindResult,
  InviteReportView,
  InviteView,
  SaveAnswersInput,
  SheetState,
  SubmitAssessmentInput,
} from '../types/invite';
import { get, post, put } from '../utils/request';

/** 邀请接口基路径（契约见 docs/api.md §13） */
const BASE = `${API_VERSION_PREFIX}/invites`;

/** 分享素材接口基路径（PRD-002 §7 的 `/reports/:id/share-image`） */
const REPORT_BASE = `${API_VERSION_PREFIX}/reports`;

/**
 * 双人邀请与对比报告接口（模块 5）
 *
 * 约定：
 * - 全部需要登录态；**邀请码不是鉴权凭证**，只是找到这条邀请的入口，
 *   能否操作一律由服务端按参与方身份判定
 * - 非参与方与「邀请 / 报告不存在」返回同一错误（10002/404），端上无法也不应区分
 * - 保存草稿用 PUT 而非 PATCH（wx.request 的 method 合法值不含 PATCH）
 * - `:code` 为 32 位十六进制邀请码；`:id` 为自增 id
 */
export const inviteApi = {
  /** 创建邀请（前置：已完成同版本单人测评 + 无进行中邀请） */
  create(scaleCode?: string): Promise<InviteCreateResult> {
    return post<InviteCreateResult, { scaleCode?: string }>(BASE, scaleCode ? { scaleCode } : {});
  },

  /** 我的邀请列表（发起方 / 被邀请方两种视角，历史报告永久可回看） */
  listMine(): Promise<InviteListItem[]> {
    return get<InviteListItem[]>(`${BASE}/mine`);
  },

  /** 打开邀请（C1：绑定第一个打开的人；发起方打开得到发起方视角） */
  open(code: string): Promise<InviteView> {
    return get<InviteView>(`${BASE}/${code}`);
  },

  /** 知情同意（R8）；agreed=false 即拒绝 → declined（发起方可换人 1 次） */
  consent(code: string, agreed: boolean): Promise<InviteView> {
    return post<InviteView, { agreed: boolean }>(`${BASE}/${code}/consent`, { agreed });
  },

  /** 打开 / 续答邀请答卷（幂等，进入答题页前调用） */
  openSheet(code: string): Promise<AssessmentDetail> {
    return post<AssessmentDetail>(`${BASE}/${code}/sheet`);
  },

  /** 保存邀请答题草稿（增量合并 + 乐观锁 30004） */
  saveDraft(code: string, payload: SaveAnswersInput): Promise<SheetState> {
    return put<SheetState, SaveAnswersInput>(`${BASE}/${code}/answers`, payload);
  },

  /** 交卷（B5 锁定）→ 双方齐备则服务端入队生成报告（R6） */
  submit(code: string, payload: SubmitAssessmentInput): Promise<InviteProgressAck> {
    return post<InviteProgressAck, SubmitAssessmentInput>(`${BASE}/${code}/answers`, payload);
  },

  /** 复用历史单人答案（C3 / R7：等同交卷，快照标注复用） */
  reuse(code: string): Promise<InviteProgressAck> {
    return post<InviteProgressAck>(`${BASE}/${code}/reuse`);
  },

  /** 读取对比报告（发起方得 L1、被邀请方得 L2；未就绪返回 pending / failed） */
  getReport(code: string): Promise<InviteReportView> {
    return get<InviteReportView>(`${BASE}/${code}/report`);
  },

  /** 换人重邀（C7，限 1 次） */
  replace(inviteId: number): Promise<InviteCreateResult> {
    return post<InviteCreateResult>(`${BASE}/${inviteId}/replace`);
  },

  /** 续期 7 天（C4，限 1 次） */
  renew(inviteId: number): Promise<InviteInitiatorView> {
    return post<InviteInitiatorView>(`${BASE}/${inviteId}/renew`);
  },

  /** 取消邀请 */
  cancel(inviteId: number): Promise<InviteInitiatorView> {
    return post<InviteInitiatorView>(`${BASE}/${inviteId}/cancel`);
  },

  /**
   * 提醒对方作答（限 3 次；未送达不消耗次数）
   * 端上须先 `wx.requestSubscribeMessage` 请对方订阅（订阅发生在被提醒之前）
   */
  remind(inviteId: number): Promise<InviteRemindResult> {
    return post<InviteRemindResult>(`${BASE}/${inviteId}/remind`);
  },

  /**
   * 生成 L3 分享版长图素材（仅发起方）
   * @param selectedBlocks 共识项题号；不传 = 默认共识区全量（PRD-002 R3）
   */
  shareMaterial(reportId: number, selectedBlocks?: string[]): Promise<DoubleReportL3Material> {
    return post<DoubleReportL3Material, { selectedBlocks?: string[] }>(
      `${REPORT_BASE}/${reportId}/share-image`,
      selectedBlocks ? { selectedBlocks } : {},
    );
  },
};
