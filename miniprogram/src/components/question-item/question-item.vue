<script setup lang="ts">
/**
 * 单题渲染组件（模块 4 答题页）
 *
 * 规格依据：
 * - 题库 v1.0：量表题（1-5）/ 选择题（①②③…，分歧比对题）/ 二选一题（16 型 A/B）
 * - constitution.md L496：量表题很不同意=1 … 很同意=5
 * - UX-001 §4.3：每屏一个视觉焦点、正文不小于 28rpx、含蓄不扎眼
 *
 * 设计说明：题型由服务端下发（paper.questions[].type），组件只做渲染，不猜测题型；
 *   选择题选项文案与二选一端点文案均来自服务端 options，组件内不出现题目文案。
 */
import { computed } from 'vue';
import { SCALE_POINT_LABELS } from '../../constants/assessment';
import type { PaperQuestion } from '../../types/assessment';

const props = defineProps<{
  question: PaperQuestion;
  /** 当前答案：量表题为分值 1-5，选择题为选项键，二选一为 'A' / 'B' */
  value?: number | string;
  /** 卷内序号（从 1 开始）与总题数，用于「第 N 题 / 共 M 题」 */
  order: number;
  total: number;
}>();

const emit = defineEmits<{ (event: 'select', value: number | string): void }>();

/** 量表题刻度：分值 1-5，文案由常量给出 */
const scalePoints = computed(() =>
  SCALE_POINT_LABELS.map((label, index) => ({ value: index + 1, label })),
);

const options = computed(() => props.question.options ?? []);

function isSelected(candidate: number | string): boolean {
  return props.value === candidate;
}

function handleSelect(candidate: number | string): void {
  emit('select', candidate);
}
</script>

<template>
  <view class="question">
    <view class="question__meta">
      <text class="question__order">第 {{ order }} 题 / 共 {{ total }} 题</text>
      <text v-if="question.reverse" class="question__tag">反向题</text>
    </view>

    <view class="question__title">{{ question.title }}</view>

    <!-- 量表题：1-5 纵向刻度，符合「含蓄、不扎眼」的视觉基调 -->
    <view v-if="question.type === 'scale'" class="options">
      <view
        v-for="point in scalePoints"
        :key="point.value"
        class="option"
        :class="{ 'option--selected': isSelected(point.value) }"
        @tap="handleSelect(point.value)"
      >
        <text class="option__label">{{ point.label }}</text>
        <view class="option__marker">
          <text class="option__marker-text">{{ point.value }}</text>
        </view>
      </view>
    </view>

    <!-- 二选一题（16 型）：两个端点文案横向卡片 -->
    <view v-else-if="question.type === 'binary'" class="binary">
      <view
        v-for="option in options"
        :key="option.key"
        class="binary__item"
        :class="{ 'binary__item--selected': isSelected(option.key) }"
        @tap="handleSelect(option.key)"
      >
        <text class="binary__text">{{ option.label }}</text>
      </view>
    </view>

    <!-- 选择题：选项键为 1..n，客户端只回传键 -->
    <view v-else class="options">
      <view
        v-for="option in options"
        :key="option.key"
        class="option option--choice"
        :class="{ 'option--selected': isSelected(option.key) }"
        @tap="handleSelect(option.key)"
      >
        <text class="option__label">{{ option.label }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.question {
  &__meta {
    display: flex;
    align-items: center;
    margin-bottom: 16rpx;
  }

  &__order {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__tag {
    padding: 2rpx 12rpx;
    margin-left: 16rpx;
    font-size: 22rpx;
    color: $zb-color-warning;
    border: 1rpx solid $zb-color-warning;
    border-radius: 999rpx;
  }

  &__title {
    margin-bottom: 40rpx;
    font-size: 36rpx;
    line-height: 1.5;
    color: $zb-color-text;
  }
}

.options {
  display: flex;
  flex-direction: column;
}

.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  margin-bottom: 16rpx;
  background-color: $zb-color-surface;
  border: 2rpx solid transparent;
  border-radius: $zb-radius-card;

  &--choice {
    justify-content: flex-start;
  }

  &--selected {
    color: $zb-color-primary;
    background-color: rgba(232, 115, 74, 0.08);
    border-color: $zb-color-primary;
  }

  &__label {
    flex: 1;
    font-size: $zb-font-size-base;
    line-height: 1.4;
  }

  &__marker {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44rpx;
    height: 44rpx;
    margin-left: 24rpx;
    border: 2rpx solid $zb-color-text-secondary;
    border-radius: 50%;
  }

  &__marker-text {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &--selected &__marker {
    border-color: $zb-color-primary;
  }

  &--selected &__marker-text {
    color: $zb-color-primary;
  }
}

.binary {
  display: flex;
  flex-direction: column;

  &__item {
    padding: 36rpx 32rpx;
    margin-bottom: 20rpx;
    background-color: $zb-color-surface;
    border: 2rpx solid transparent;
    border-radius: $zb-radius-card;
  }

  &__item--selected {
    background-color: rgba(232, 115, 74, 0.08);
    border-color: $zb-color-primary;
  }

  &__text {
    font-size: $zb-font-size-base;
    line-height: 1.5;
    color: $zb-color-text;
  }
}
</style>
