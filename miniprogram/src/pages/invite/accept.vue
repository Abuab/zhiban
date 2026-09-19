<script setup lang="ts">
/**
 * 邀请入口页（被邀请方，模块 5）
 *
 * 职责（PRD-002 R8 / C1 / C3 / C7）：
 *   1. 用邀请码打开邀请（`GET /invites/:code`）——服务端在此把邀请码绑定到首个打开者（C1）
 *   2. 展示知情同意书并强制勾选，同意 / 拒绝都需用户显式操作（R8）
 *   3. 同意后一次性订阅提醒（订阅授权必须发生在被提醒之前，否则发起方提醒不到 TA）
 *   4. 若存在同版本历史答卷，让用户选择「复用历史答案」或「重新作答」（C3 / R7）
 *
 * 不在此页做的事：答题（跳答题页共用实现）、报告（跳对比报告页）。
 * 发起方自己打开链接时不展示任何同意 / 复用界面，直接进详情页管理自己的邀请。
 */
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { inviteApi } from '../../api/invite';
import { ApiErrorCode } from '../../constants/error-code';
import {
  INVITE_CODE_PATTERN,
  INVITE_DETAIL_PAGE_PATH,
  INVITE_NOTICE_PAGE_PATH,
  INVITE_STATUS,
} from '../../constants/invite';
import { INVITE_DATA_CONSENT_CHECKBOX_TEXT, INVITE_DATA_NOTICE_TITLE } from '../../constants/legal';
import type { InviteInviteeView } from '../../types/invite';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

/** 被邀请方已交卷的状态（此时无需再进答题页，回详情页等对方 / 看报告） */
const FINISHED_STATUSES: readonly string[] = [INVITE_STATUS.COMPLETED, INVITE_STATUS.REPORT_UNLOCKED];

const loading = ref(true);
const errorText = ref('');
const code = ref('');
/** 被邀请方视角数据（加载成功后非空） */
const view = ref<InviteInviteeView | null>(null);
/** 知情同意勾选态：默认不勾（隐私约束 2.4 不设默认同意） */
const agreed = ref(false);
/** 用户已勾选但尚未提交同意（同意接口失败时用于重试提示） */
const submitting = ref(false);
/** 复用选择阶段：同意成功且有可复用历史答卷时进入 */
const stage = ref<'consent' | 'reuse'>('consent');
const reusing = ref(false);

const initiatorLabel = computed(() => view.value?.initiatorNickname || '对方');

onLoad((options) => {
  const raw = ((options ?? {}) as Record<string, string>).code ?? '';
  const normalized = raw.trim().toLowerCase();
  if (!INVITE_CODE_PATTERN.test(normalized)) {
    // 分享链接可能被截断 / 改写：格式不符时服务端必然 404，先给出明确提示再回首页
    loading.value = false;
    errorText.value = '邀请链接不完整或已失效';
    return;
  }
  code.value = normalized;
  void init();
});

async function init(): Promise<void> {
  loading.value = true;
  errorText.value = '';

  // A4：打开邀请需要登录态（邀请码要绑定到具体 openid，C1）
  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await inviteApi.open(code.value);
    if (result.role === 'initiator') {
      // 发起方打开自己的链接：不占被邀请方名额，也不展示同意书（服务端同样如此判定）
      uni.redirectTo({ url: `${INVITE_DETAIL_PAGE_PATH}?code=${code.value}` });
      return;
    }
    view.value = result;

    if (FINISHED_STATUSES.includes(result.status)) {
      gotoDetail();
      return;
    }
    if (result.consentGiven) {
      // 已同意过（多端 / 中断重进）：直接继续答题，不重复弹同意书
      gotoAssessment();
      return;
    }
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 知情同意（R8）

async function handleAgree(): Promise<void> {
  if (!view.value || submitting.value) return;
  if (!agreed.value) {
    uni.showToast({ title: '请先阅读并勾选同意', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    const updated = await inviteApi.consent(code.value, true);
    if (updated.role === 'invitee') view.value = updated;
    // 订阅授权须在「被提醒」之前发生；失败不阻断同意流程（发起方提醒时会得到未订阅提示）
    requestRemindSubscribe(updated.role === 'invitee' ? updated.remindTemplateId : null);

    const reuse = updated.role === 'invitee' ? updated.reuse : null;
    if (reuse?.allowed && reuse.available) {
      stage.value = 'reuse';
      return;
    }
    gotoAssessment();
  } catch (error) {
    handleActionError(error);
  } finally {
    submitting.value = false;
  }
}

async function handleDecline(): Promise<void> {
  if (!view.value || submitting.value) return;

  const confirmed = await confirmDialog('确定不同意吗？', '不同意后本次邀请将结束，对方可以重新邀请其他人。');
  if (!confirmed) return;

  submitting.value = true;
  try {
    await inviteApi.consent(code.value, false);
    uni.showToast({ title: '已结束本次邀请', icon: 'none' });
    backHome();
  } catch (error) {
    handleActionError(error);
  } finally {
    submitting.value = false;
  }
}

/**
 * 一次性订阅提醒（微信订阅消息）
 * 必须由用户点击触发，故调用点紧跟「同意」这一显式操作；用户拒绝订阅时不报错。
 */
function requestRemindSubscribe(templateId: string | null): void {
  if (!templateId) return;
  uni.requestSubscribeMessage({
    tmplIds: [templateId],
    fail: () => {
      // 拒绝订阅后仍可正常作答与看报告，只是收不到提醒 —— 不打断主流程
    },
  });
}

// ------------------------------------------------------------------ 复用历史答案（C3 / R7）

async function handleReuse(): Promise<void> {
  if (reusing.value) return;
  reusing.value = true;
  uni.showLoading({ title: '正在处理', mask: true });
  try {
    // 复用 = 以历史答案作为本次双人作答并直接完成（服务端语义，见 docs/api.md §13.8）
    await inviteApi.reuse(code.value);
    gotoDetail();
  } catch (error) {
    handleActionError(error);
  } finally {
    reusing.value = false;
    uni.hideLoading();
  }
}

function handleAnswerAgain(): void {
  gotoAssessment();
}

// ------------------------------------------------------------------ 导航与提示

function gotoAssessment(): void {
  uni.redirectTo({ url: `/pages/assessment/assessment?code=${code.value}` });
}

/**
 * 查看《双人数据处理说明》全文（ADR-012 决策 3）
 * 用 navigateTo 而非 redirectTo：看完要回到本页继续勾选同意，同意动作必须发生在本页。
 */
function handleOpenNotice(): void {
  uni.navigateTo({ url: INVITE_NOTICE_PAGE_PATH });
}

function gotoDetail(): void {
  uni.redirectTo({ url: `${INVITE_DETAIL_PAGE_PATH}?code=${code.value}` });
}

function backHome(): void {
  const pages = getCurrentPages();
  // 分享卡片直接落地本页时没有上一页，此时回首页而不是卡死
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  uni.reLaunch({ url: '/pages/index/index' });
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '邀请打开失败，请重试';
  return '邀请打开失败，请重试';
}

/** 同意 / 拒绝 / 复用 失败后的统一出口：需要用户换动作的错误单独引导 */
function handleActionError(error: unknown): void {
  if (error instanceof ApiError) {
    if (error.code === ApiErrorCode.INVITE_ALREADY_ACCEPTED) {
      uni.showToast({ title: error.message, icon: 'none' });
      backHome();
      return;
    }
    uni.showToast({ title: error.message || '操作失败，请重试', icon: 'none' });
    return;
  }
  uni.showToast({ title: '操作失败，请重试', icon: 'none' });
}

function confirmDialog(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText: '确定',
      cancelText: '再想想',
      success: (res) => resolve(res.confirm === true),
      fail: () => resolve(false),
    });
  });
}

function handleRetry(): void {
  void init();
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在打开邀请…</text>
    </view>

    <!-- 加载失败 / 链接异常：可重试或返回，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button class="action" @tap="handleRetry">重试</button>
      <button class="action action--ghost" @tap="backHome">返回首页</button>
    </view>

    <!-- 知情同意（R8）：文案由服务端下发，与留痕用同一份原文 -->
    <view v-else-if="view && stage === 'consent'" class="content">
      <view class="title">{{ initiatorLabel }} 邀请你一起做一份关系测评</view>
      <view class="desc">
        你们会用同一份题目各自作答，双方都提交后生成一份共识与差异分析。
      </view>

      <view class="card">
        <view class="card__title">作答前请确认</view>
        <view class="card__text">{{ view.consentText }}</view>
      </view>

      <view class="check" @tap="agreed = !agreed">
        <view class="check__box" :class="{ 'check__box--on': agreed }">
          <text v-if="agreed" class="check__tick">✓</text>
        </view>
        <text class="check__text">{{ INVITE_DATA_CONSENT_CHECKBOX_TEXT }}</text>
      </view>

      <!-- 查看全文（ADR-012 决策 3）：同意页只放 R8 原句，完整说明在独立页 -->
      <text class="full-text" @tap="handleOpenNotice">
        《{{ INVITE_DATA_NOTICE_TITLE }}》查看全文
      </text>

      <button
        class="action"
        :loading="submitting"
        :disabled="submitting || !agreed"
        @tap="handleAgree"
      >
        同意并开始
      </button>
      <button class="action action--ghost" :disabled="submitting" @tap="handleDecline">
        不同意
      </button>
    </view>

    <!-- 复用历史答案（C3 / R7）：仅在确实存在同版本历史答卷且邀请允许复用时出现 -->
    <view v-else-if="view && stage === 'reuse'" class="content">
      <view class="title">发现你之前答过同一份量表</view>
      <view class="desc">
        可以直接沿用上次的答案作为本次作答，也可以重新答一遍。沿用会让报告标注「复用」，不影响报告生成。
      </view>
      <view v-if="view.reuse.submittedAt" class="card">
        <view class="card__row">
          <text class="card__label">上次提交时间</text>
          <text class="card__value">{{ view.reuse.submittedAt }}</text>
        </view>
      </view>

      <button class="action" :loading="reusing" :disabled="reusing" @tap="handleReuse">
        沿用上次答案
      </button>
      <button class="action action--ghost" :disabled="reusing" @tap="handleAnswerAgain">
        重新作答
      </button>
    </view>
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

  &__text {
    font-size: $zb-font-size-base;
    color: $zb-color-text-secondary;
  }
}

.content {
  padding-top: 24rpx;
}

.title {
  margin-bottom: 16rpx;
  font-size: $zb-font-size-report-title;
  font-weight: 600;
  color: $zb-color-text;
}

.desc {
  margin-bottom: 32rpx;
  font-size: $zb-font-size-base;
  line-height: 1.7;
  color: $zb-color-text-secondary;
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
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }

  &__row {
    display: flex;
    justify-content: space-between;
  }

  &__label {
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }

  &__value {
    font-size: 26rpx;
    color: $zb-color-text;
  }
}

.check {
  display: flex;
  align-items: center;
  padding: 16rpx 0 8rpx;

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

.full-text {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $zb-color-primary;
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
