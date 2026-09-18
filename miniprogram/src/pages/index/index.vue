<script setup lang="ts">
/**
 * 首页
 * 规格依据：
 *   - 宪法 §2.4：启动即弹《隐私政策》，不同意则仅可浏览首页；未满 18 岁不可使用
 *   - 边界总表 A4：未登录用户点击需要登录的内容 → 先引导登录
 * 说明：
 *   App.vue 在小程序端不渲染 UI，因此启动弹窗挂在首页（用户进入小程序的第一个页面）
 *   下方「服务端自检」卡片是模块 1 的链路验证工具，非产品功能
 */
import { ref, watch } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { ENV } from '../../config/env';
import { ApiError, get } from '../../utils/request';
import { brandName } from '../../stores/app-config';
import { isLoggedIn, userProfile } from '../../stores/user';
import { acceptPrivacyPolicy, confirmAge, gotoLogin, logout, refusePrivacyPolicy } from '../../utils/auth';
import { privacyConsent } from '../../utils/privacy';
import ConsentModal from '../../components/consent-modal/consent-modal.vue';

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

const showPrivacyModal = ref(false);
const showAgeModal = ref(false);

const loading = ref(false);
const liveness = ref<LivenessResult | null>(null);
const readiness = ref<ReadinessResult | null>(null);
const errorText = ref('');

onLoad(() => {
  void check();
});

onShow(() => {
  applyBrandTitle();
  // 启动即弹：未表态 / 曾拒绝 / 政策升版 都要重新征得同意（宪法 §2.4）
  showPrivacyModal.value = privacyConsent.needsConsent();
  syncAgeGate();
});

// 配置接口返回晚于首屏时，导航栏标题需跟着更新（pages.json 里的标题只在冷启动瞬间作兜底）
watch(brandName, applyBrandTitle);

/** 首页导航栏标题跟随品牌配置（ADR-002） */
function applyBrandTitle(): void {
  uni.setNavigationBarTitle({ title: brandName.value });
}

/** 年龄确认：已登录但未确认成年则弹窗（隐私约束 2.4） */
function syncAgeGate(): void {
  showAgeModal.value = isLoggedIn.value && userProfile.value?.ageConfirmed !== true;
}

async function handleAcceptPrivacy(): Promise<void> {
  showPrivacyModal.value = false;
  await acceptPrivacyPolicy();
  syncAgeGate();
}

function handleRefusePrivacy(): void {
  showPrivacyModal.value = false;
  refusePrivacyPolicy();
  uni.showToast({ title: '不同意隐私政策，仅可浏览首页', icon: 'none' });
}

async function handleAcceptAge(): Promise<void> {
  showAgeModal.value = false;
  try {
    await confirmAge();
  } catch (error) {
    const detail = error as ApiError;
    uni.showToast({ title: detail.message || '提交失败，请重试', icon: 'none' });
  }
}

async function handleRejectAge(): Promise<void> {
  showAgeModal.value = false;
  await logout();
  uni.showToast({ title: '本产品仅面向已满 18 周岁的用户', icon: 'none' });
}

function handleAccount(): void {
  gotoLogin();
}

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
</script>

<template>
  <view class="page">
    <view class="card">
      <view class="card__title">账号</view>
      <view class="row">
        <text class="row__label">登录状态</text>
        <text class="row__value">{{ isLoggedIn ? '已登录' : '未登录' }}</text>
      </view>
      <view class="row">
        <text class="row__label">昵称</text>
        <text class="row__value">{{ userProfile?.nickname || '—' }}</text>
      </view>
      <button class="action" @tap="handleAccount">
        {{ isLoggedIn ? '查看我的账号' : '登录 / 注册' }}
      </button>
    </view>

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

    <ConsentModal
      :visible="showPrivacyModal"
      mode="privacy"
      @accept="handleAcceptPrivacy"
      @reject="handleRefusePrivacy"
    />
    <ConsentModal
      :visible="showAgeModal"
      mode="age"
      @accept="handleAcceptAge"
      @reject="handleRejectAge"
    />
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
  margin-bottom: 12rpx;

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

  &::after {
    border: none;
  }
}
</style>
