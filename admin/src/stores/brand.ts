import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { fetchPublicConfig } from '@/api/config';
import { ENV } from '@/config/env';

export const useBrandStore = defineStore('brand', () => {
  /** 接口下发的品牌名；null 表示尚未取到 */
  const remoteBrandName = ref<string | null>(null);
  /** 是否已发起过加载（无论成败都只加载一次） */
  const loaded = ref(false);

  /**
   * 对外展示的品牌名，取不到时降级为 ENV.brandName（来自 .env，代码中不写字面量）
   */
  const brandName = computed(() => remoteBrandName.value ?? ENV.brandName);

  /** 浏览器标签页标题，如「知伴 管理后台」 */
  const pageTitle = computed(() => `${brandName.value} ${ENV.adminName}`);

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
