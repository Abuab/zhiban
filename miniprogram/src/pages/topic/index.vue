<script setup lang="ts">
/**
 * 议题列表（模块 7）
 *
 * 职责：8 个议题包的入口，展示解锁态 / 续看位置 / 打卡状态。
 *
 * 说明：
 *   1. 卡片流本身**免费可浏览**，付费墙只挡 AI 专属卡；`unlocked` 只影响详情页专属卡的分支，
 *      故本页不把它当作进入门槛（PRD-005 §1：解锁判定一律读服务端下发值）。
 *   2. 议题标题、副标题全部来自服务端（运营可在后台改），端上不写死任何议题文案。
 */
import { ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { topicApi } from '../../api/topic';
import { TOPIC_DETAIL_PAGE_PATH, TOPIC_FINISHED_BADGE } from '../../constants/topic';
import type { TopicListItem } from '../../types/topic';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
const items = ref<TopicListItem[]>([]);

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
    items.value = await topicApi.list();
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '加载失败，请下拉重试';
  } finally {
    loading.value = false;
  }
}

function openTopic(code: string): void {
  uni.navigateTo({ url: `${TOPIC_DETAIL_PAGE_PATH}?code=${code}` });
}

/**
 * 卡片的续看提示
 * 用「上次读到第 N 张」而不是百分比：卡片流是离散的，用户能对上号（§9.4 续看）。
 */
function progressText(item: TopicListItem): string {
  if (item.finished) return TOPIC_FINISHED_BADGE;
  if (item.lastOrderNo > 0) return `继续看 · 上次读到第 ${item.lastOrderNo + 1} 张`;
  return '从头开始看';
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">正在加载…</view>

    <view v-else-if="errorText" class="placeholder">
      <view class="placeholder__text">{{ errorText }}</view>
      <button class="action" @tap="load">重新加载</button>
    </view>

    <template v-else>
      <view v-if="items.length === 0" class="placeholder">
        <view class="placeholder__text">暂时没有可看的内容</view>
      </view>

      <view
        v-for="item in items"
        :key="item.code"
        class="topic"
        @tap="openTopic(item.code)"
      >
        <view class="topic__head">
          <text class="topic__title">{{ item.title }}</text>
          <text v-if="item.finished" class="badge badge--done">{{ TOPIC_FINISHED_BADGE }}</text>
        </view>
        <view v-if="item.subtitle" class="topic__subtitle">{{ item.subtitle }}</view>
        <view class="topic__meta">{{ progressText(item) }}</view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 32rpx;
  background-color: $zb-color-bg;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  text-align: center;

  &__text {
    margin-bottom: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.topic {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &:active {
    opacity: 0.85;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 34rpx;
    font-weight: 600;
  }

  &__subtitle {
    margin-top: 12rpx;
    font-size: $zb-font-size-base;
    color: $zb-color-text-secondary;
  }

  &__meta {
    margin-top: 20rpx;
    font-size: 24rpx;
    color: $zb-color-primary;
  }
}

.badge {
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  border-radius: 999rpx;

  &--done {
    color: $zb-color-success;
    background-color: rgba(76, 154, 106, 0.12);
  }
}

.action {
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
