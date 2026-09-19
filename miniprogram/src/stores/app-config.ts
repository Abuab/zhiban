import { ref } from 'vue';
import { configApi } from '../api/config';
import { ENV } from '../config/env';
import { SAFETY_FALLBACK_SELFCHECK_ITEMS } from '../constants/safety';
import type { PublicConfig } from '../types/api';

/**
 * 站点公开配置（内存态）
 * 规格依据：ADR-002 —— 品牌名等运行时文案由管理后台配置，前端读取展示；
 *          ADR-010 —— 安全页自查清单、客服二维码与说明文案同源下发
 * 设计：
 *   1. 兜底值必须存在：接口失败时用兜底品牌名渲染，不弹错、不阻塞启动流程（边界总表 A5 不出现死页）
 *   2. 不落本地存储：仅内存持有，避免引入「本地缓存了旧品牌名」的一致性问题
 */

/** 品牌名兜底值：取自构建期环境变量，与 manifest.json / pages.json 同源（不写死字面量） */
export const DEFAULT_BRAND_NAME = ENV.brandName;

/** 当前品牌名（响应式：接口返回后绑定它的页面自动更新） */
export const brandName = ref(DEFAULT_BRAND_NAME);

/** 婚前事实确认清单（ADR-010 决策 3）：接口失败或未配置时用兜底常量，保证页面不空白 */
export const safetySelfCheckItems = ref<readonly string[]>(SAFETY_FALLBACK_SELFCHECK_ITEMS);

/**
 * 客服二维码图片地址（ADR-010 决策 5）
 * **fail-closed**：空串 = 未配置（页面只显示客服按钮，不显示空白图框）；
 * 非 https 或格式非法一律按未配置处理。
 */
export const supportQrcodeUrl = ref('');

/** 客服二维码说明文案；服务端留空即为空串（页面据此不渲染说明文字，也不留占位空格） */
export const supportQrcodeTip = ref('');

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
    safetySelfCheckItems.value = resolveSelfCheckItems(config);
    supportQrcodeUrl.value = resolveHttpsUrl(config.support?.qrcode_url);
    supportQrcodeTip.value = (config.support?.qrcode_tip ?? '').trim();
  } catch {
    // 静默降级：这些文案不属于关键路径，失败时保持兜底值即可
  }
}

/** 服务端可能返回空串（运营误改），此处统一收敛为兜底值 */
function resolveBrandName(config: PublicConfig): string {
  const name = (config.brand?.name ?? '').trim();
  return name || DEFAULT_BRAND_NAME;
}

/** 清单只接受「非空字符串数组」；类型不符或为空数组时回退兜底常量（判据与服务端 value_type=json 一致） */
function resolveSelfCheckItems(config: PublicConfig): readonly string[] {
  const items = config.safety?.selfcheck?.items;
  if (!Array.isArray(items)) return SAFETY_FALLBACK_SELFCHECK_ITEMS;
  const cleaned = items.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return cleaned.length > 0 ? cleaned : SAFETY_FALLBACK_SELFCHECK_ITEMS;
}

/** https 绝对地址（含主机名，不含空白字符） */
const HTTPS_URL_PATTERN = /^https:\/\/[^\s/]+(\/[^\s]*)?$/;

/**
 * 只接受可解析的 https 绝对地址，其余一律返回空串（= 未配置）
 *
 * ⚠️ 小程序运行时**没有 `URL` 全局对象**（微信未实现 DOM/Node 的 URL），
 * 故先做严格正则判定；若宿主恰好提供了 `URL` 则再解析一次复核。
 * 这样既不依赖宿主能力，又保持「非 https 一律视为未配置」的 fail-closed 语义。
 */
function resolveHttpsUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!HTTPS_URL_PATTERN.test(value)) return '';

  if (typeof URL === 'function') {
    try {
      return new URL(value).protocol === 'https:' ? value : '';
    } catch {
      return '';
    }
  }
  return value;
}
