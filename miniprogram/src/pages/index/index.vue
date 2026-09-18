<script setup lang="ts">
/**
 * 脚手架自检页（模块 1 验证用，非产品页面）
 * 作用：在小程序端验证「环境变量 → 请求封装 → 服务端统一响应」整条链路是否打通
 */
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { ENV } from '../../config/env';
import { ApiError, get } from '../../utils/request';

interface LivenessResult {
  status: string;
  uptimeSec: number;
  env: string;
  timestamp: string;
}

interface ReadinessResult {
  status: string;
  checks: { database: string; redis: string };
}

const loading = ref(false);
const liveness = ref<LivenessResult | null>(null);
const readiness = ref<ReadinessResult | null>(null);
const errorText = ref('');

async function check(): Promise<void> {
  loading.value = true;
  errorText.value = '';
  liveness.value = null;
  readiness.value = null;
  try {
    // 健康检查接口无需登录态
    liveness.value = await get<LivenessResult>('/health', { needAuth: false });
    readiness.value = await get<ReadinessResult>('/health/ready', { needAuth: false });
  } catch (error) {
    const detail = error as ApiError;
    errorText.value = detail.message || '请求失败';
  } finally {
    loading.value = false;
  }
}

onLoad(() => {
  void check();
});
</script>

<template>
  <view class="page">
    <view class="card">
      <view class="card__title">运行环境</view>
      <view class="row">
        <text class="row__label">环境标识</text>
        <text class="row__value">{{ ENV.appEnv }}</text>
      </view>
      <view class="row">
        <text class="row__label">接口地址</text>
        <text class="row__value">{{ ENV.apiBaseUrl }}</text>
      </view>
    </view>

    <view class="card">
      <view class="card__title">服务端自检</view>
      <view class="row">
        <text class="row__label">进程存活</text>
        <text class="row__value">{{ liveness ? liveness.status : '—' }}</text>
      </view>
      <view class="row">
        <text class="row__label">MySQL</text>
        <text class="row__value">{{ readiness ? readiness.checks.database : '—' }}</text>
      </view>
      <view class="row">
        <text class="row__label">Redis</text>
        <text class="row__value">{{ readiness ? readiness.checks.redis : '—' }}</text>
      </view>
      <view v-if="errorText" class="error">{{ errorText }}</view>
    </view>

    <button class="action" :loading="loading" :disabled="loading" @tap="check">重新检测</button>
  </view>
</template>

<style lang="scss" scoped>
.page {
  padding: 32rpx;
}

.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 16rpx;
    font-size: 32rpx;
    font-weight: 600;
  }
}

.row {
  display: flex;
  justify-content: space-between;

  &__label {
    color: $zb-color-text-secondary;
  }

  &__value {
    max-width: 60%;
    text-align: right;
    word-break: break-all;
  }
}

.error {
  margin-top: 16rpx;
  color: $zb-color-danger;
}

.action {
  margin-top: 32rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }
}
</style>
