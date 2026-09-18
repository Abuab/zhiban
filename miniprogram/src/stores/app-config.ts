import { ref } from 'vue';
import { configApi } from '../api/config';
import type { PublicConfig } from '../types/api';

/**
 * 站点公开配置（内存态）
 * 规格依据：ADR-002 —— 品牌名等运行时文案由管理后台配置，前端读取展示
 * 设计：
 *   1. 兜底值必须存在：接口失败时用兜底品牌名渲染，不弹错、不阻塞启动流程（边界总表 A5 不出现死页）
 *   2. 不落本地存储：仅内存持有，避免引入「本地缓存了旧品牌名」的一致性问题
 */

/** 品牌名兜底值：与 pages.json / manifest.json 的编译期默认值保持一致 */
export const DEFAULT_BRAND_NAME = '知伴';

/** 当前品牌名（响应式：接口返回后绑定它的页面自动更新） */
export const brandName = ref(DEFAULT_BRAND_NAME);

let done = false;
let inFlight: Promise<void> | null = null;

/**
 * 拉取站点公开配置（同一次启动内只请求一次，并发调用共用同一请求）
 * 失败静默降级为兜底值，不影响隐私政策弹窗与登录流程
 */
export function loadPublicConfig(): Promise<void> {
  if (done) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = requestPublicConfig().finally(() => {
    done = true;
    inFlight = null;
  });
  return inFlight;
}

async function requestPublicConfig(): Promise<void> {
  try {
    const config = await configApi.getPublic();
    brandName.value = resolveBrandName(config);
  } catch {
    // 静默降级：品牌名不属于关键路径，失败时保持兜底值即可
  }
}

/** 服务端可能返回空串（运营误改），此处统一收敛为兜底值 */
function resolveBrandName(config: PublicConfig): string {
  const name = (config.brand?.name ?? '').trim();
  return name || DEFAULT_BRAND_NAME;
}
