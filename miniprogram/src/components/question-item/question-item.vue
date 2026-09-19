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
 *
 * ADR-013 决策 7 新增两种展示态（由父组件判定，组件不自带业务判断）：
 *   - `sensitiveHint`：敏感维度内的琥珀提示条 + 右侧「不愿回答」出口；
 *   - `skipped`：已跳过态，不渲染选项，只给「改主意，回答这题」撤销出口。
 */
import { computed } from 'vue';
import {
  SCALE_POINT_LABELS,
  SENSITIVE_QUESTION_HINT,
  SKIP_QUESTION_ACTION,
  SKIPPED_QUESTION_NOTICE,
  UNSKIP_QUESTION_ACTION,
} from '../../constants/assessment';
import type { PaperQuestion } from '../../types/assessment';

const props = defineProps<{
  question: PaperQuestion;
  /** 当前答案：量表题为分值 1-5，选择题为选项键，二选一为 'A' / 'B' */
  value?: number | string;
  /** 卷内序号（从 1 开始）与总题数，用于「第 N 题 / 共 M 题」 */
  order: number;
  total: number;
  /** 敏感题提示条（ADR-013 决策 7）：仅敏感维度内、且本题未被跳过时为 true */
  sensitiveHint?: boolean;
  /** 已跳过态（ADR-013 决策 7）：true 时隐藏序号与选项，改为展示跳过说明 */
  skipped?: boolean;
}>();

const emit = defineEmits<{
  (event: 'select', value: number | string): void;
  (event: 'skip'): void;
  (event: 'unskip'): void;
}>();

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

function handleSkip(): void {
  emit('skip');
}

function handleUnskip(): void {
  emit('unskip');
}
</script>

<template>
  <view class="question">
    <!-- 敏感题提示条（ADR-013 决策 7）：题目上方叠加，只在敏感维度内且本题未跳过时出现 -->
    <view v-if="sensitiveHint && !skipped" class="sensitive">
      <text class="sensitive__text">{{ SENSITIVE_QUESTION_HINT }}</text>
      <text class="sensitive__action" @tap="handleSkip">{{ SKIP_QUESTION_ACTION }}</text>
    </view>

    <!-- 已跳过的题已从进度分母中剔除，序号会跳号，故整块隐藏（ADR-013 决策 7） -->
    <view v-if="!skipped" class="question__meta">
      <text class="question__order">第 {{ order }} 题 / 共 {{ total }} 题</text>
      <text v-if="question.reverse" class="question__tag">反向题</text>
    </view>

    <view class="question__title">{{ question.title }}</view>

    <!-- 已跳过态：不渲染量表选项，只给撤销出口 -->
    <view v-if="skipped" class="skipped">
      <text class="skipped__text">{{ SKIPPED_QUESTION_NOTICE }}</text>
      <button class="skipped__action" @tap="handleUnskip">{{ UNSKIP_QUESTION_ACTION }}</button>
    </view>

    <template v-else>
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
    </template>
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

// 敏感题提示条（ADR-013 决策 7）：琥珀浅底 + 琥珀描边，与其他提示卡区分但同色系
.sensitive {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-warning-bg;
  border: 2rpx solid $zb-color-warning-border;
  border-radius: $zb-radius-card;

  &__text {
    flex: 1;
    font-size: 26rpx;
    line-height: 1.6;
    color: $zb-color-text;
  }

  &__action {
    margin-left: 24rpx;
    font-size: 26rpx;
    color: $zb-color-warning;
  }
}

// 已跳过态：不再渲染选项，只保留题干与撤销出口
.skipped {
  padding: 32rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__text {
    font-size: 26rpx;
    line-height: 1.6;
    color: $zb-color-text-secondary;
  }

  &__action {
    margin-top: 24rpx;
    font-size: 26rpx;
    color: $zb-color-primary;
    background-color: transparent;

    &::after {
      border: none;
    }
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
