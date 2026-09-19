import { API_VERSION_PREFIX } from '../config/env';
import type {
  ExclusiveCardView,
  SaveTopicProgressInput,
  TopicDetailView,
  TopicListItem,
  TopicProgressAck,
} from '../types/topic';
import { get, post, put } from '../utils/request';

/** 内容域接口基路径（契约见 docs/api.md §15） */
const BASE = `${API_VERSION_PREFIX}/topics`;

/**
 * 锦囊卡片流接口（模块 7）
 *
 * 约定：
 * - 全部需要登录态；**解锁判定一律读服务端下发的 `locked` / `unlocked`**，
 *   端上不自行判定（PRD-005 §1）
 * - 专属卡**必须用户点击**才生成（详情接口不隐式触发生成），生成后反复读缓存不再计费
 * - 进度上报用 PUT 而非 PATCH（wx.request 的 method 合法值不含 PATCH）
 */
export const topicApi = {
  /** 议题列表（含解锁态、续看位置、挂载维度） */
  list(): Promise<TopicListItem[]> {
    return get<TopicListItem[]>(BASE);
  },

  /** 议题详情 / 卡片流（一次拉齐卡片 + 进度 + 专属卡状态） */
  detail(code: string): Promise<TopicDetailView> {
    return get<TopicDetailView>(`${BASE}/${code}`);
  },

  /** 上报阅读进度（服务端单调不减；`finished` 一经打卡不可取消） */
  saveProgress(code: string, payload: SaveTopicProgressInput): Promise<TopicProgressAck> {
    return put<TopicProgressAck, SaveTopicProgressInput>(`${BASE}/${code}/progress`, payload);
  },

  /**
   * 生成 AI 专属卡（用户点击触发）
   * 已在生成中（并发）返回 `50004`，端上提示稍后刷新而非反复重试
   */
  generateExclusiveCard(code: string): Promise<ExclusiveCardView> {
    return post<ExclusiveCardView>(`${BASE}/${code}/exclusive-card`);
  },
};
