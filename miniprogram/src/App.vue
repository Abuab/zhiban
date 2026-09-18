<script setup lang="ts">
import { onLaunch, onShow, onError } from '@dcloudio/uni-app';
import { ENV } from './config/env';

onLaunch(() => {
  // 启动即打印当前环境，便于排查「构建产物连了测试环境」这类事故
  console.log(`[知伴] 启动成功，环境=${ENV.appEnv}，接口地址=${ENV.apiBaseUrl}`);
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
