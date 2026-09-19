import { get, patch, request } from './http';
import type {
  AdminConfigItem,
  ConfigGroup,
  ConfigListQuery,
  ConfigListResult,
  PublicConfig,
  UpdateConfigInput,
  UploadImageResult,
} from '@/types/api';

/** 站点公开配置（免鉴权，登录前即可获取品牌名等展示文案） */
export function fetchPublicConfig(): Promise<PublicConfig> {
  return get<PublicConfig>('/v1/config/public');
}

/** 配置分组清单（含每组条目数） */
export function fetchConfigGroups(): Promise<ConfigGroup[]> {
  return get<ConfigGroup[]>('/admin/configs/groups');
}

/** 配置分页列表 */
export function fetchConfigList(query: ConfigListQuery): Promise<ConfigListResult> {
  const params: Record<string, unknown> = {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
  };
  if (query.group) params.group = query.group;
  return get<ConfigListResult>('/admin/configs', params);
}

/** 编辑单个配置项（值 / 是否公开 / 说明，至少传一项） */
export function updateConfig(
  configKey: string,
  data: UpdateConfigInput,
): Promise<AdminConfigItem> {
  return patch<AdminConfigItem>(`/admin/configs/${encodeURIComponent(configKey)}`, { ...data });
}

/**
 * 上传图片（后台专用，ADR-010 决策 5）
 * - multipart/form-data，文件字段名固定 file；Authorization 由请求拦截器统一带上
 * - 不手动设置 Content-Type：交给浏览器补 multipart boundary（写死会导致后端解析失败）
 * - 返回的 url 需由调用方回填输入框并另存（上传不等于保存，保留「改动必留审计」）
 */
export function uploadImage(file: File): Promise<UploadImageResult> {
  const data = new FormData();
  data.append('file', file);
  return request<UploadImageResult>({ url: '/admin/uploads/image', method: 'POST', data });
}
