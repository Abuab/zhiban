<script setup lang="ts">
/**
 * 议题卡片流（模块 7）
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.1（专属卡生成位置）/ §9.4（前端渲染）、
 *   docs/adr/ADR-007.md（免费领取权益 / 生成一次缓存 / 用户点击生成 / 单人版降级）、
 *   docs/adr/ADR-008.md（缓存归属 / 降级与模型内容端上不可区分）
 *
 * 实现要点：
 *   1. **竖向 swiper 全屏一卡 + 底部圆点进度**（§9.4 原文）；专属卡是**最后一卡**，
 *      但它不在 `cards` 数组里（服务端单独下发 `exclusiveCard`），故最后一屏由本页补位。
 *   2. **解锁判定只读服务端**：`locked` 决定锁形占位 / 生成按钮，端上不做任何权益推断。
 *   3. **降级不可区分**：接口不下发生成状态与降级原因，`ready = true` 即按正常内容淡入。
 *   4. 进度以服务端回传值为准：上报节流（滑动会高频触发），且服务端单调不减，
 *      端上滑回上一张卡不会把续看位置退回去。
 *   5. 所有运营文案（卡片正文、演练选项与解析、专属卡内容、价格）来自接口，端上不写死。
 */
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { paymentApi } from '../../api/payment';
import { topicApi } from '../../api/topic';
import { ApiErrorCode } from '../../constants/error-code';
import { ENTITLEMENT_PAGE_PATH } from '../../constants/entitlement';
import {
  CARD_TYPE,
  CARD_TYPE_FALLBACK_LABEL,
  CARD_TYPE_LABELS,
  COPY_ACTION_SHEET_ITEM,
  COPY_SUCCESS_TOAST,
  EXCLUSIVE_BUSY_TOAST,
  EXCLUSIVE_GENERATE_ACTION,
  EXCLUSIVE_GENERATING_TEXT,
  EXCLUSIVE_LOCKED_TITLE,
  EXCLUSIVE_UNLOCK_ACTION,
  PROGRESS_REPORT_INTERVAL_MS,
  TOPIC_FINISH_ACTION,
  TOPIC_FINISHED_BADGE,
} from '../../constants/topic';
import { PRODUCT_TOPIC_SINGLE_PREFIX } from '../../types/payment';
import type { ExclusiveCardView, TopicCardOption, TopicCardView, TopicDetailView } from '../../types/topic';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
const code = ref('');
const detail = ref<TopicDetailView | null>(null);
const exclusive = ref<ExclusiveCardView | null>(null);

/** 当前卡序（0..cards.length；最后一位是专属卡） */
const current = ref(0);
/** 演练卡作答：卡序 → 选中的选项 key（只在首次点击时写入，避免反复改判） */
const quizPicked = ref<Record<number, string>>({});
const finished = ref(false);
const generating = ref(false);
const unlocking = ref(false);
const finishing = ref(false);

const cards = computed<TopicCardView[]>(() => detail.value?.cards ?? []);
/** 专属卡在 swiper 中的下标（它是最后一屏） */
const exclusiveIndex = computed(() => cards.value.length);
const totalCount = computed(() => cards.value.length + 1);

/** 进度上报节流：只在卡序确实变化时上报，且两次上报至少间隔 PROGRESS_REPORT_INTERVAL_MS */
let lastReportedOrderNo = 0;
let pendingOrderNo: number | null = null;
let reportTimer: ReturnType<typeof setTimeout> | null = null;

onLoad((options) => {
  const raw = ((options ?? {}) as Record<string, string>).code ?? '';
  code.value = raw.trim();
  void load();
});

onUnload(() => {
  if (reportTimer) {
    clearTimeout(reportTimer);
    reportTimer = null;
  }
  // 离开时补齐最后一次位置（服务端单调不减，重复上报无副作用）
  void flushProgress();
});

async function load(): Promise<void> {
  loading.value = true;
  errorText.value = '';

  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const view = await topicApi.detail(code.value);
    detail.value = view;
    exclusive.value = view.exclusiveCard;
    finished.value = view.progress.finished;
    lastReportedOrderNo = view.progress.lastOrderNo;
    // 续看：定位到上次停留的卡（§9.4「可续看」）。+1 的下标越界由 min 兜住（进度上限 ≤ 卡数）
    current.value = Math.min(view.progress.lastOrderNo, view.cards.length);

    uni.setNavigationBarTitle({ title: view.title });
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '加载失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 进度上报

function handleChange(event: { detail: { current: number } }): void {
  const index = event.detail.current;
  current.value = index;
  scheduleProgress(index);
}

function scheduleProgress(orderNo: number): void {
  if (orderNo === lastReportedOrderNo) return;
  pendingOrderNo = orderNo;
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    void flushProgress();
  }, PROGRESS_REPORT_INTERVAL_MS);
}

async function flushProgress(): Promise<void> {
  const orderNo = pendingOrderNo;
  pendingOrderNo = null;
  if (orderNo === null || orderNo === lastReportedOrderNo) return;

  lastReportedOrderNo = orderNo;
  try {
    const ack = await topicApi.saveProgress(code.value, { lastOrderNo: orderNo });
    // 服务端单调不减：以它回传的值为准纠正本地（端上回退不会写库）
    lastReportedOrderNo = ack.lastOrderNo;
    finished.value = ack.finished;
  } catch {
    // 进度上报失败不打断阅读（A5 不出现死页），下次滑动会再报
  }
}

async function handleFinish(): Promise<void> {
  if (finishing.value || finished.value) return;
  finishing.value = true;
  try {
    const ack = await topicApi.saveProgress(code.value, {
      lastOrderNo: current.value,
      finished: true,
    });
    finished.value = ack.finished;
    uni.showToast({ title: TOPIC_FINISHED_BADGE, icon: 'none' });
  } catch (error) {
    uni.showToast({
      title: error instanceof ApiError ? error.message : '打卡失败，请稍后重试',
      icon: 'none',
    });
  } finally {
    finishing.value = false;
  }
}

// ------------------------------------------------------------------ 卡片交互

function typeLabel(card: TopicCardView): string {
  return CARD_TYPE_LABELS[card.type] ?? CARD_TYPE_FALLBACK_LABEL;
}

/** 话术卡长按：先弹 action-sheet 再复制（避免误触把正文写进剪贴板，§9.4） */
function handleCopy(body: string): void {
  uni.showActionSheet({
    itemList: [COPY_ACTION_SHEET_ITEM],
    success: () => {
      uni.setClipboardData({
        data: body,
        success: () => uni.showToast({ title: COPY_SUCCESS_TOAST, icon: 'none' }),
      });
    },
  });
}

function pickedKey(card: TopicCardView): string | null {
  return quizPicked.value[card.orderNo] ?? null;
}

function optionClass(card: TopicCardView, option: TopicCardOption): Record<string, boolean> {
  const picked = pickedKey(card);
  if (!picked) return {};
  if (option.key !== picked) return { 'option--muted': true };
  return { 'option--picked': true, 'option--right': option.correct, 'option--wrong': !option.correct };
}

/** 点选后立即出 ✔/✘ + 解析（§9.4）；已作答的卡不再改判，避免反复点击换来换去 */
function pickOption(card: TopicCardView, option: TopicCardOption): void {
  if (card.type !== CARD_TYPE.QUIZ || pickedKey(card)) return;
  quizPicked.value = { ...quizPicked.value, [card.orderNo]: option.key };
}

function pickedOption(card: TopicCardView): TopicCardOption | null {
  const picked = pickedKey(card);
  if (!picked || !card.options) return null;
  return card.options.find((option) => option.key === picked) ?? null;
}

function explainText(card: TopicCardView): string {
  const picked = pickedOption(card);
  if (picked?.explain) return picked.explain;
  // 选项本身没写解析时退回正确答案的解析（内容侧约定每题都有，这里只作兜底）
  return card.options?.find((option) => option.correct)?.explain ?? '';
}

// ------------------------------------------------------------------ 专属卡

/** 解锁（P1 全免费：下单即到账，无需调起支付） */
async function handleUnlock(): Promise<void> {
  if (unlocking.value) return;
  if (exclusive.value?.price === null || exclusive.value?.price === undefined) {
    uni.showToast({ title: '该议题包暂不可解锁', icon: 'none' });
    return;
  }

  unlocking.value = true;
  try {
    const result = await paymentApi.createOrder(`${PRODUCT_TOPIC_SINGLE_PREFIX}${code.value}`);
    if (!result.settled) {
      // P1（PAYMENT_GATEWAY=free）恒为 settled；非 settled 说明该商品需要真实支付（P2），
      // 订单已落库，引导到「我的权益」查看订单与恢复购买
      uni.navigateTo({ url: ENTITLEMENT_PAGE_PATH });
      return;
    }
    await load();
  } catch (error) {
    uni.showToast({
      title: error instanceof ApiError ? error.message : '解锁失败，请稍后重试',
      icon: 'none',
    });
  } finally {
    unlocking.value = false;
  }
}

async function handleGenerate(): Promise<void> {
  if (generating.value) return;
  generating.value = true;
  try {
    exclusive.value = await topicApi.generateExclusiveCard(code.value);
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.code === ApiErrorCode.EXCLUSIVE_CARD_GENERATING
          ? EXCLUSIVE_BUSY_TOAST
          : error.message
        : '生成失败，请稍后重试';
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">正在加载…</view>

    <view v-else-if="errorText" class="placeholder">
      <view class="placeholder__text">{{ errorText }}</view>
      <button class="action" @tap="load">重新加载</button>
    </view>

    <template v-else-if="detail">
      <!-- 竖向 swiper：全屏一卡（§9.4）；最后一屏是专属卡 -->
      <swiper class="flow" vertical :current="current" :duration="280" @change="handleChange">
        <swiper-item v-for="card in cards" :key="card.orderNo" class="flow__item">
          <view class="card">
            <view class="card__head">
              <text class="tag">{{ typeLabel(card) }}</text>
              <text v-if="card.title" class="card__title">{{ card.title }}</text>
            </view>

            <view class="card__body" :class="{ 'card__body--copyable': card.copyable }" @longpress="card.copyable && handleCopy(card.body)">
              {{ card.body }}
            </view>

            <!-- 演练卡：点选后立即出 ✔/✘ + 解析条 -->
            <view v-if="card.type === CARD_TYPE.QUIZ && card.options" class="options">
              <view
                v-for="option in card.options"
                :key="option.key"
                class="option"
                :class="optionClass(card, option)"
                @tap="pickOption(card, option)"
              >
                <text class="option__key">{{ option.key }}</text>
                <text class="option__text">{{ option.text }}</text>
              </view>

              <view v-if="pickedOption(card)" class="explain" :class="pickedOption(card)?.correct ? 'explain--right' : 'explain--wrong'">
                <text class="explain__mark">{{ pickedOption(card)?.correct ? '✔' : '✘' }}</text>
                <text class="explain__text">{{ explainText(card) }}</text>
              </view>
            </view>

            <view v-if="card.copyable" class="card__hint">长按卡片可复制这段话</view>
          </view>
        </swiper-item>

        <!-- 最后一屏：AI 专属卡（未解锁 = 锁形占位 + 价格；已解锁 = 骨架屏 → 内容淡入） -->
        <swiper-item class="flow__item">
          <view class="card">
            <view class="card__head">
              <text class="tag tag--exclusive">专属</text>
              <text class="card__title">{{ detail.title }}</text>
            </view>

            <template v-if="exclusive?.locked">
              <view class="lock">
                <view class="lock__mark">＊</view>
                <view class="lock__title">{{ EXCLUSIVE_LOCKED_TITLE }}</view>
                <view class="lock__desc">解锁本议题包后，按你们俩的测评结果生成专属建议</view>
                <button class="action" :loading="unlocking" :disabled="unlocking" @tap="handleUnlock">
                  <text v-if="exclusive.price !== null">¥{{ exclusive.price }} · </text>{{ EXCLUSIVE_UNLOCK_ACTION }}
                </button>
              </view>
            </template>

            <template v-else-if="generating">
              <view class="skeleton">
                <view class="skeleton__line" />
                <view class="skeleton__line skeleton__line--short" />
                <view class="skeleton__line" />
                <view class="skeleton__line skeleton__line--short" />
                <view class="skeleton__tip">{{ EXCLUSIVE_GENERATING_TEXT }}</view>
              </view>
            </template>

            <template v-else-if="exclusive?.ready">
              <view class="exclusive fade-in">{{ exclusive.content }}</view>
            </template>

            <template v-else>
              <view class="lock">
                <view class="lock__title">{{ EXCLUSIVE_GENERATE_ACTION }}</view>
                <view class="lock__desc">会结合你们俩的测评结果与这个议题的分歧点来写</view>
                <button class="action" @tap="handleGenerate">{{ EXCLUSIVE_GENERATE_ACTION }}</button>
              </view>
            </template>
          </view>
        </swiper-item>
      </swiper>

      <!-- 底部圆点进度（§9.4）+ 末卡打卡 -->
      <view class="footer">
        <button
          v-if="current === exclusiveIndex"
          class="action action--finish"
          :loading="finishing"
          :disabled="finished || finishing"
          @tap="handleFinish"
        >
          {{ finished ? TOPIC_FINISHED_BADGE : TOPIC_FINISH_ACTION }}
        </button>
        <view class="dots">
          <view
            v-for="index in totalCount"
            :key="index"
            class="dot"
            :class="{ 'dot--active': index - 1 === current }"
          />
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page {
  height: 100vh;
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

.flow {
  height: 100vh;

  &__item {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40rpx 32rpx 200rpx;
    box-sizing: border-box;
  }
}

.card {
  width: 100%;
  max-height: 100%;
  padding: 40rpx;
  overflow-y: auto;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;
  box-sizing: border-box;

  &__head {
    display: flex;
    align-items: center;
    margin-bottom: 24rpx;
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
  }

  &__body {
    font-size: 34rpx;
    line-height: 1.7;
  }

  &__hint {
    margin-top: 24rpx;
    font-size: 22rpx;
    color: $zb-color-text-secondary;
  }
}

.tag {
  padding: 4rpx 16rpx;
  margin-right: 16rpx;
  font-size: 22rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;
  border-radius: 999rpx;

  &--exclusive {
    background-color: $zb-color-primary-dark;
  }
}

.options {
  margin-top: 32rpx;
}

.option {
  display: flex;
  align-items: flex-start;
  padding: 20rpx;
  margin-bottom: 16rpx;
  background-color: $zb-color-bg;
  border-radius: $zb-radius-card;

  &__key {
    margin-right: 16rpx;
    font-weight: 600;
  }

  &__text {
    flex: 1;
    font-size: $zb-font-size-base;
  }

  &--picked {
    border: 1rpx solid $zb-color-primary;
  }

  &--right {
    background-color: rgba(76, 154, 106, 0.12);
  }

  &--wrong {
    background-color: rgba(196, 85, 63, 0.1);
  }

  &--muted {
    opacity: 0.5;
  }
}

.explain {
  display: flex;
  align-items: flex-start;
  padding: 20rpx;
  margin-top: 8rpx;
  background-color: $zb-color-bg;
  border-radius: $zb-radius-card;

  &__mark {
    margin-right: 12rpx;
  }

  &__text {
    flex: 1;
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }

  &--right .explain__mark {
    color: $zb-color-success;
  }

  &--wrong .explain__mark {
    color: $zb-color-danger;
  }
}

.lock {
  padding: 24rpx 0;
  text-align: center;

  &__mark {
    font-size: 64rpx;
    color: $zb-color-warning;
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
  }

  &__desc {
    margin: 16rpx 0 32rpx;
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }
}

.skeleton {
  padding: 24rpx 0;

  &__line {
    height: 32rpx;
    margin-bottom: 24rpx;
    background-color: rgba(138, 128, 120, 0.18);
    border-radius: 8rpx;
    animation: skeleton-pulse 1.2s ease-in-out infinite;

    &--short {
      width: 60%;
    }
  }

  &__tip {
    margin-top: 32rpx;
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

.exclusive {
  font-size: 32rpx;
  line-height: 1.8;
}

.fade-in {
  animation: fade-in 0.4s ease-in;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(12rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.footer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16rpx 32rpx 32rpx;
}

.action {
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }

  &--finish {
    width: 100%;
    margin-bottom: 20rpx;
  }

  &::after {
    border: none;
  }
}

.dots {
  display: flex;
  align-items: center;
  justify-content: center;
}

.dot {
  width: 12rpx;
  height: 12rpx;
  margin: 0 8rpx;
  background-color: rgba(138, 128, 120, 0.35);
  border-radius: 50%;

  &--active {
    width: 28rpx;
    background-color: $zb-color-primary;
    border-radius: 999rpx;
  }
}
</style>
