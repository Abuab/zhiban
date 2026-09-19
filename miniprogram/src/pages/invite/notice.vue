<script setup lang="ts">
/**
 * 双人数据处理说明页（ADR-012 决策 2 的**发起方同意采集点**）
 *
 * 为什么要有这一页：
 *   R8 原文写的是「**双方**答题前均须勾选」，而此前只采集了被邀请方的同意
 *   （`POST /v1/invites/:code/consent`），发起方从未被明确告知/同意「自己的 L2 摘要会给对方看」。
 *   本页承载完整说明 + 勾选，勾选后由邀请首页在创建请求里带上 `dataConsentAgreed: true`，
 *   服务端据此写 `consent_log`（同意留证，ADR-012 决策 1）。
 *
 * 刻意不做的事：
 *   1. 本页**不调用任何创建接口** —— 创建逻辑全项目只有邀请首页 `handleCreate` 一处，
 *      本页只把控制权交回去（`?dataConsent=1`），避免两份 create 调用迟早漂移。
 *   2. **不写本地存储**（不用 `uni.setStorage` 记住「已同意过」）：每次创建都要重新勾选，
 *      这是每次都要真实发生的合规动作，记住它会让第二次创建失去留证依据。
 */
import { ref } from 'vue';
import { INVITE_DATA_CONSENT_PARAM, INVITE_LIST_PAGE_PATH } from '../../constants/invite';
import {
  INVITE_DATA_CONSENT_AGREE_TEXT,
  INVITE_DATA_CONSENT_CHECKBOX_TEXT,
  INVITE_DATA_CONSENT_DECLINE_TEXT,
  INVITE_DATA_CONSENT_TEXT,
  INVITE_DATA_CONSENT_VERSION,
  INVITE_DATA_CONSENT_VERSION_PREFIX,
  INVITE_DATA_NOTICE_POINTS,
  INVITE_DATA_NOTICE_TITLE,
} from '../../constants/legal';

/** 勾选态：默认不勾（合规要求不设默认同意），仅存在于页面 data，不落任何存储 */
const agreed = ref(false);

/**
 * 同意并继续：把控制权交回邀请首页继续创建流程
 * 用 redirectTo 而非 navigateTo：本页已无用（用户已完成勾选），替换掉它可避免
 * 用户从创建结果返回时又看到说明页。
 */
function handleAgree(): void {
  if (!agreed.value) return;
  uni.redirectTo({ url: `${INVITE_LIST_PAGE_PATH}?${INVITE_DATA_CONSENT_PARAM}=1` });
}

/** 暂不同意：返回上一页（不创建配对、不产生同意留证）；无上一页时回邀请首页，不卡死 */
function handleDecline(): void {
  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  uni.redirectTo({ url: INVITE_LIST_PAGE_PATH });
}
</script>

<template>
  <view class="page">
    <view class="title">{{ INVITE_DATA_NOTICE_TITLE }}</view>

    <!-- R8 原句逐字展示并突出：这是双方都必须看过的核心范围约定 -->
    <view class="card card--highlight">
      <text class="card__text">{{ INVITE_DATA_CONSENT_TEXT }}</text>
    </view>

    <view class="card">
      <view v-for="(point, index) in INVITE_DATA_NOTICE_POINTS" :key="index" class="point">
        <text class="point__index">{{ index + 1 }}</text>
        <text class="point__text">{{ point }}</text>
      </view>
    </view>

    <!-- 版本号用常量拼接，不硬编码（与服务端 consent_log.policy_version 同源） -->
    <view class="version">{{ INVITE_DATA_CONSENT_VERSION_PREFIX }}{{ INVITE_DATA_CONSENT_VERSION }}</view>

    <view class="check" @tap="agreed = !agreed">
      <view class="check__box" :class="{ 'check__box--on': agreed }">
        <text v-if="agreed" class="check__tick">✓</text>
      </view>
      <text class="check__text">{{ INVITE_DATA_CONSENT_CHECKBOX_TEXT }}</text>
    </view>

    <button class="action" :disabled="!agreed" @tap="handleAgree">
      {{ INVITE_DATA_CONSENT_AGREE_TEXT }}
    </button>
    <button class="action action--ghost" @tap="handleDecline">
      {{ INVITE_DATA_CONSENT_DECLINE_TEXT }}
    </button>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 32rpx;
  background-color: $zb-color-bg;
}

.title {
  margin-bottom: 24rpx;
  font-size: $zb-font-size-report-title;
  font-weight: 600;
  color: $zb-color-text;
}

.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &--highlight {
    border: 1rpx solid $zb-color-primary;
  }

  &__text {
    font-size: 28rpx;
    line-height: 1.8;
    color: $zb-color-text;
  }
}

.point {
  display: flex;
  margin-bottom: 20rpx;

  &:last-child {
    margin-bottom: 0;
  }

  &__index {
    flex-shrink: 0;
    width: 40rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-primary;
  }

  &__text {
    flex: 1;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.version {
  margin-bottom: 24rpx;
  font-size: 22rpx;
  color: $zb-color-text-secondary;
  text-align: center;
}

.check {
  display: flex;
  align-items: center;
  padding: 8rpx 0 16rpx;

  &__box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40rpx;
    height: 40rpx;
    margin-right: 16rpx;
    border: 2rpx solid rgba(138, 128, 120, 0.5);
    border-radius: 8rpx;

    &--on {
      background-color: $zb-color-primary;
      border-color: $zb-color-primary;
    }
  }

  &__tick {
    font-size: 26rpx;
    line-height: 1;
    color: $zb-color-surface;
  }

  &__text {
    font-size: 26rpx;
    color: $zb-color-text;
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
