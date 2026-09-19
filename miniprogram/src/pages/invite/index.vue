<script setup lang="ts">
/**
 * 邀请首页（模块 5）
 *
 * 职责：
 *   1. 发起双人邀请（PRD-002 §5 前置：需先完成同版本单人测评；同时最多 1 个进行中邀请）
 *   2. 我的邀请列表——发起方与被邀请方两种角色混排，历史报告永久可回看
 *
 * 为什么把「已完成单人测评」做成前置引导而不是直接报错：
 *   服务端返回 `40007` 时用户拿到的是一个没有出口的错误（ADR-005 决策 7 特意与 40004 分开），
 *   端上据此把用户直接送到单人测评页，本次意图（想邀人）不会丢。
 */
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { inviteApi } from '../../api/invite';
import { SCENE_SINGLE } from '../../constants/assessment';
import { ApiErrorCode } from '../../constants/error-code';
import {
  ACTIVE_INVITE_STATUSES,
  INVITE_DETAIL_PAGE_PATH,
  INVITE_ROLE,
  INVITE_ROLE_LABELS,
  INVITE_STATUS_FALLBACK_LABEL,
  INVITE_STATUS_LABELS,
} from '../../constants/invite';
import type { InviteListItem } from '../../types/invite';
import { ensureLogin } from '../../utils/auth';
import { formatDate } from '../../utils/format';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
const creating = ref(false);
const items = ref<InviteListItem[]>([]);

/** 我发起的、仍在进行中的邀请（同一时间最多 1 个，PRD-002 §5） */
const activeInvite = computed<InviteListItem | null>(
  () =>
    items.value.find(
      (item) => item.role === INVITE_ROLE.INITIATOR && ACTIVE_INVITE_STATUSES.includes(item.status),
    ) ?? null,
);

onShow(() => {
  void load();
});

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});

async function load(): Promise<void> {
  errorText.value = '';

  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    items.value = await inviteApi.listMine();
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 发起邀请

async function handleCreate(): Promise<void> {
  if (creating.value) return;

  // 已有进行中的邀请：不再调创建接口（服务端也会拒绝），直接带用户过去
  if (activeInvite.value) {
    openDetail(activeInvite.value.code);
    return;
  }

  creating.value = true;
  uni.showLoading({ title: '正在创建', mask: true });
  try {
    const result = await inviteApi.create();
    openDetail(result.code);
  } catch (error) {
    handleCreateError(error);
  } finally {
    creating.value = false;
    uni.hideLoading();
  }
}

function handleCreateError(error: unknown): void {
  if (!(error instanceof ApiError)) {
    uni.showToast({ title: '创建失败，请重试', icon: 'none' });
    return;
  }

  // 前置条件缺失：引导去完成单人测评（做完回来即可发起）
  if (error.code === ApiErrorCode.INVITE_PREREQUISITE_MISSING) {
    uni.showModal({
      title: '先完成一次单人测评',
      content: error.message || '双方需要答同一份量表才能对比，先花几分钟完成它吧。',
      confirmText: '去测评',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) uni.navigateTo({ url: `/pages/assessment/assessment?scene=${SCENE_SINGLE}` });
      },
    });
    return;
  }

  // 已有进行中的邀请：刷新列表后由用户点进去（避免端上与服务端状态不一致）
  if (error.code === ApiErrorCode.INVITE_ALREADY_ACTIVE) {
    uni.showToast({ title: error.message || '已有进行中的邀请', icon: 'none' });
    void load();
    return;
  }

  uni.showToast({ title: error.message || '创建失败，请重试', icon: 'none' });
}

// ------------------------------------------------------------------ 展示

function openDetail(code: string): void {
  uni.navigateTo({ url: `${INVITE_DETAIL_PAGE_PATH}?code=${code}` });
}

function statusLabel(item: InviteListItem): string {
  return INVITE_STATUS_LABELS[item.status] ?? INVITE_STATUS_FALLBACK_LABEL;
}

function roleLabel(item: InviteListItem): string {
  return INVITE_ROLE_LABELS[item.role] ?? '';
}

/** 列表里的对象称谓：未绑定（对方还没打开）时不给昵称，避免看着像「有人已经参与」 */
function counterpartLabel(item: InviteListItem): string {
  if (item.counterpartNickname) return item.counterpartNickname;
  return item.role === INVITE_ROLE.INITIATOR ? '对方尚未打开' : '发起方';
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '加载失败，请重试';
  return '加载失败，请重试';
}

function handleRetry(): void {
  loading.value = true;
  void load();
}

function handleStartAssessment(): void {
  uni.navigateTo({ url: `/pages/assessment/assessment?scene=${SCENE_SINGLE}` });
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__title">双人邀请</view>
      <view class="hero__desc">
        用同一份量表各自作答，双方都提交后生成一份共识与差异分析。详细分析由发起人持有，被邀请人可见基础摘要。
      </view>
    </view>

    <view class="card">
      <template v-if="activeInvite">
        <view class="card__title">你有一个进行中的邀请</view>
        <view class="row">
          <text class="row__label">状态</text>
          <text class="row__value">{{ statusLabel(activeInvite) }}</text>
        </view>
        <view class="row">
          <text class="row__label">对象</text>
          <text class="row__value">{{ counterpartLabel(activeInvite) }}</text>
        </view>
        <button class="action" @tap="handleCreate">查看并继续</button>
      </template>
      <template v-else>
        <view class="card__title">发起邀请</view>
        <view class="card__text">
          需要你先完成一次婚前关系准备评估（双方答同一份题目才能对比）。创建后可把邀请卡片发给对方。
        </view>
        <button class="action" :loading="creating" :disabled="creating" @tap="handleCreate">
          发起双人邀请
        </button>
        <button class="action action--ghost" @tap="handleStartAssessment">先做单人测评</button>
      </template>
    </view>

    <view class="card">
      <view class="card__title">我的邀请</view>

      <view v-if="loading" class="hint">正在加载…</view>
      <template v-else-if="errorText">
        <view class="hint hint--error">{{ errorText }}</view>
        <button class="action action--ghost" @tap="handleRetry">重试</button>
      </template>
      <view v-else-if="items.length === 0" class="hint">还没有邀请记录</view>

      <view v-else class="list">
        <view v-for="item in items" :key="item.inviteId" class="item" @tap="openDetail(item.code)">
          <view class="item__head">
            <text class="item__name">{{ counterpartLabel(item) }}</text>
            <text class="item__status">{{ statusLabel(item) }}</text>
          </view>
          <view class="item__meta">
            <text class="item__tag">{{ roleLabel(item) }}</text>
            <text class="item__time">{{ formatDate(item.createdAt) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 32rpx;
  background-color: $zb-color-bg;
}

.hero {
  margin-bottom: 32rpx;

  &__title {
    margin-bottom: 16rpx;
    font-size: $zb-font-size-report-title;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__desc {
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 16rpx;
    font-size: 30rpx;
    font-weight: 600;
  }

  &__text {
    margin-bottom: 8rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 8rpx 0;

  &__label {
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }

  &__value {
    font-size: 26rpx;
    color: $zb-color-text;
  }
}

.hint {
  padding: 24rpx 0;
  font-size: 26rpx;
  color: $zb-color-text-secondary;

  &--error {
    color: $zb-color-danger;
  }
}

.list {
  margin-top: 8rpx;
}

.item {
  padding: 24rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__status {
    font-size: 26rpx;
    color: $zb-color-primary;
  }

  &__meta {
    display: flex;
    justify-content: space-between;
    margin-top: 8rpx;
  }

  &__tag,
  &__time {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.action {
  margin-top: 24rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }

  &--ghost {
    color: $zb-color-text-secondary;
    background-color: transparent;
  }

  &::after {
    border: none;
  }
}
</style>
