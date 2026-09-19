import { API_VERSION_PREFIX } from '../config/env';
import type {
  AssessmentDetail,
  AssessmentReport,
  ResumeSummary,
  SaveAnswersInput,
  SheetState,
  StartableScene,
  SubmitAssessmentInput,
  SupplementInput,
} from '../types/assessment';
import { get, post, put } from '../utils/request';

/** 测评接口基路径（模块 4 的 7 个接口，契约见 docs/api.md §12） */
const BASE = `${API_VERSION_PREFIX}/assessments`;

/**
 * 单人测评接口
 *
 * 约定：
 * - 全部需要登录态；服务端逐个校验「答题卷属于本人」，非本人一律 10004（403）
 * - `saveDraft` 用 PUT 而非 PATCH：wx.request 的 method 合法值不含 PATCH
 * - `saveDraft` 为**增量合并**语义（本次未出现的题号保留服务端原答案），
 *   适配弱网分批补传（B2）
 */
export const assessmentApi = {
  /**
   * 开始作答（B1）
   * 已有进行中的草稿则直接续答，不会新建；交卷后再次调用会新建一份（B6 重测）
   */
  start(scene: StartableScene): Promise<AssessmentDetail> {
    return post<AssessmentDetail, { scene: StartableScene }>(BASE, { scene });
  },

  /** 续答入口摘要（入口展示「继续上次（已完成 32/76 题）」）；无草稿返回 null */
  getCurrent(scene: StartableScene): Promise<ResumeSummary | null> {
    return get<ResumeSummary | null>(`${BASE}/current`, { data: { scene } });
  },

  /** 答题页数据（状态 + 题目 + 卷首文案，一次拉齐） */
  getDetail(sheetId: number): Promise<AssessmentDetail> {
    return get<AssessmentDetail>(`${BASE}/${sheetId}`);
  },

  /** 保存草稿（断点续答 B1 / 弱网补传 B2 / 多端乐观锁 A3） */
  saveDraft(sheetId: number, payload: SaveAnswersInput): Promise<SheetState> {
    return put<SheetState, SaveAnswersInput>(`${BASE}/${sheetId}/draft`, payload);
  },

  /** 交卷（B5 锁定答案）→ 直接返回简版报告 */
  submit(sheetId: number, payload: SubmitAssessmentInput): Promise<AssessmentReport> {
    return post<AssessmentReport, SubmitAssessmentInput>(`${BASE}/${sheetId}/submit`, payload);
  },

  /** 读取简版报告（未交卷返回 40005） */
  getReport(sheetId: number): Promise<AssessmentReport> {
    return get<AssessmentReport>(`${BASE}/${sheetId}/report`);
  },

  /** 补答被跳过的敏感维度（B7 事后补答） */
  supplement(sheetId: number, payload: SupplementInput): Promise<AssessmentReport> {
    return post<AssessmentReport, SupplementInput>(`${BASE}/${sheetId}/supplement`, payload);
  },
};
