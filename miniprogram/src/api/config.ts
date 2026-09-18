import { API_VERSION_PREFIX } from '../config/env';
import type { PublicConfig } from '../types/api';
import { get } from '../utils/request';

/** 站点配置接口基路径（契约见 docs/api.md §9） */
const BASE = `${API_VERSION_PREFIX}/config`;

/**
 * 站点配置接口（ADR-002）
 * 说明：getPublic 是免鉴权接口，登录前即可调用（品牌名要在登录页就展示）
 */
export const configApi = {
  /** 站点公开配置（仅服务端标记为公开的键） */
  getPublic(): Promise<PublicConfig> {
    return get<PublicConfig>(`${BASE}/public`, { needAuth: false });
  },
};
