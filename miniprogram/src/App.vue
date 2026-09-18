<script setup lang="ts">
import { onLaunch, onShow, onError } from '@dcloudio/uni-app';
import { ENV } from './config/env';
import { loadPublicConfig } from './stores/app-config';
import { bootstrapAuth, registerUnauthorizedHandler, reportPrivacyConsent } from './utils/auth';
import { privacyConsent } from './utils/privacy';

/**
 * 应用启动（规格依据：PRD-005 §3 启动流程、边界总表 A1、ADR-002）
 * 说明：App.vue 在小程序端不承担渲染（页面 UI 都在 pages 内），只做全局编排：
 *   1. 注册 401 静默重登处理器 —— 任何接口 token 失效都自动重登并重放（A1 用户无感）
 *   2. 拉取站点公开配置（品牌名等）—— 登录前就要展示，故先于隐私判断发起
 *   3. 已同意隐私政策才发起登录；未同意则保持游客态，仅可浏览首页（隐私约束 2.4）
 */
onLaunch(() => {
  // 启动即打印当前环境，便于排查「构建产物连了测试环境」这类事故
  console.log(`[知伴] 启动成功，环境=${ENV.appEnv}，接口地址=${ENV.apiBaseUrl}`);

  registerUnauthorizedHandler();

  // 免鉴权，登录前即可取；失败静默降级为兜底品牌名，不阻塞后续流程
  void loadPublicConfig();

  if (!privacyConsent.isAgreed()) return;

  void (async () => {
    await bootstrapAuth();
    await reportPrivacyConsent();
  })();
});

onShow(() => {
  console.log('[知伴] 前台显示');
});

onError((error) => {
  console.error('[知伴] 运行异常：', error);
});
</script>

<style lang="scss">
/* uni.scss 由 uni-app 全局自动注入，此处无需再 @import */
page {
  background-color: $zb-color-bg;
  color: $zb-color-text;
  font-size: 28rpx;
  line-height: 1.6;
}
</style>
