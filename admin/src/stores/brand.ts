import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { fetchPublicConfig } from '@/api/config';

/**
 * 品牌名兜底常量（仅此一处允许的通用兜底文案）
 * 说明：品牌名唯一真源是服务端配置（sys_config.brand.name），前端禁止硬编码
 */
export const DEFAULT_BRAND_NAME = '管理后台';

export const useBrandStore = defineStore('brand', () => {
  /** 接口下发的品牌名；null 表示尚未取到 */
  const remoteBrandName = ref<string | null>(null);
  /** 是否已发起过加载（无论成败都只加载一次） */
  const loaded = ref(false);

  /** 对外展示的品牌名，取不到时降级为兜底文案 */
  const brandName = computed(() => remoteBrandName.value ?? DEFAULT_BRAND_NAME);

  /** 浏览器标签页标题 */
  const pageTitle = computed(() =>
    remoteBrandName.value ? `${remoteBrandName.value} 管理后台` : DEFAULT_BRAND_NAME,
  );

  /** 加载品牌配置；失败静默降级，不得阻塞页面渲染 */
  async function load(): Promise<void> {
    if (loaded.value) return;
    loaded.value = true;
    try {
      const config = await fetchPublicConfig();
      const name = config?.brand?.name?.trim();
      if (name) remoteBrandName.value = name;
    } catch {
      // 品牌名获取失败不影响后台使用，静默降级为兜底文案
    } finally {
      document.title = pageTitle.value;
    }
  }

  return { brandName, pageTitle, loaded, load };
});
