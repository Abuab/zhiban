<script setup lang="ts">
/**
 * 简版报告页（模块 4 完成标准：一个人可以从头到尾测完并看到简版报告）
 *
 * 规格依据：
 *   - 宪法 L520-522：单人测评 + 简版报告免费，内容 = 8 维度答题 + 雷达图 + 一句话点评
 *   - 《价值感与内容标准》§一「简版对照」：维度解读 = 一句话点评 ≤30 字、**无昵称**、仅分数
 *   - 《价值感与内容标准》§二.3：报告生成 = 雷达图逐维度点亮动画（≤2 秒）
 *   - 《价值感与内容标准》§三：付费墙只做「信息差可视化」，文案不含内容本体
 *   - 规格 2.3：页脚固定免责声明（服务端下发，前端不硬编码）
 *   - 规格 2.2：16 型只展示自研类型名与四维度端点，不出现官方代号
 *   - 边界总表 B3/B4（低质量提示）、B7（未评估维度标注，不展示 0 分）、B9（底线题中性提示）
 *   - 边界总表 A4/A5：未登录先引导登录；加载失败可重试，不做死页
 *
 * 文案来源：正文区块（INTRO、各维度点评）与付费墙占位全部由服务端模板下发
 *   —— 运营改文案无需发版（宪法 P5），前端不硬编码任何解读文案。
 * 分数档位：规格未定义单人分数分档，故本页不对分数做「高/中/低」措辞与配色（ADR-004 决策 3.5）。
 */
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { assessmentApi } from '../../api/assessment';
import RadarChart from '../../components/radar-chart/radar-chart.vue';
import { RADAR_MAX_DIMENSIONS, SCENE_P16, SCENE_SINGLE } from '../../constants/assessment';
import { ApiErrorCode } from '../../constants/error-code';
import type { AssessmentReport, RadarItem, StartableScene } from '../../types/assessment';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
/** 报告未生成（40005）时引导回答题页，而不是只给一句错误 */
const needAnswering = ref(false);
const report = ref<AssessmentReport | null>(null);
const scene = ref<StartableScene>(SCENE_SINGLE);

onLoad((options) => {
  const sheetId = Number((options as Record<string, string> | undefined)?.sheetId ?? 0);
  if (!sheetId) {
    loading.value = false;
    errorText.value = '缺少报告标识，请从测评入口重新进入';
    return;
  }
  void init(sheetId);
});

async function init(sheetId: number): Promise<void> {
  loading.value = true;
  errorText.value = '';
  needAnswering.value = false;

  // A4：报告属于登录后可见内容，未登录先引导登录
  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await assessmentApi.getReport(sheetId);
    report.value = result;
    scene.value = result.scene === SCENE_P16 ? SCENE_P16 : SCENE_SINGLE;
    // 报告页标题取量表名（服务端下发）
    uni.setNavigationBarTitle({ title: result.scaleName });
  } catch (error) {
    if (error instanceof ApiError && error.code === ApiErrorCode.REPORT_NOT_READY) {
      needAnswering.value = true;
    }
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/** 卷首说明（块键 INTRO；文案来自服务端模板） */
const introText = computed(
  () => report.value?.blocks.find((block) => block.blockKey === 'INTRO')?.text ?? '',
);

/** 维度编码 → 一句话点评（模板块键 = 维度编码，ADR-004 决策 3） */
const commentByCode = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const block of report.value?.blocks ?? []) {
    map[block.blockKey] = block.text;
  }
  return map;
});

/** 雷达图数据：未评估维度传 null，由组件标注「未评估」且不参与绘制（B7） */
const radarItems = computed<RadarItem[]>(() =>
  (report.value?.dimensions ?? []).map((item) => ({ label: item.name, value: item.score })),
);

/** 维度数不足 3 个无法构成多边形，此时只展示点评列表 */
const canDrawRadar = computed(
  () =>
    radarItems.value.length >= 3 &&
    radarItems.value.length <= RADAR_MAX_DIMENSIONS &&
    radarItems.value.some((item) => item.value !== null),
);

/** 交卷时间（只到日期，报告页无需精确到分秒） */
const submittedText = computed(() => {
  const raw = report.value?.submittedAt;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
});

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 16 型维度结论文案（规格未定义各类型解读文案，故只呈现引擎事实数据：
 * 端点取向 + 该维度 A / B 端选择数），平局按裁决 A-7 提示两端接近
 */
function poleText(dimension: { pole: 'A' | 'B'; aCount: number; bCount: number; isTie: boolean }): string {
  const counts = `A ${dimension.aCount} · B ${dimension.bCount}`;
  return dimension.isTie ? `两端接近（${counts}）` : `偏 ${dimension.pole} 端（${counts}）`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '报告加载失败，请重试';
  return '报告加载失败，请重试';
}

function handleRetry(): void {
  const sheetId = report.value?.sheetId ?? 0;
  if (sheetId) {
    void init(sheetId);
    return;
  }
  uni.reLaunch({ url: '/pages/index/index' });
}

/** 40005：报告未生成 → 回到答题页继续作答（断点续答由答题页负责，B1） */
function handleGoAnswering(): void {
  uni.redirectTo({ url: `/pages/assessment/assessment?scene=${scene.value}` });
}

function handleBackHome(): void {
  uni.reLaunch({ url: '/pages/index/index' });
}
</script>

<template>
  <view class="page">
    <!-- 加载中 -->
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在生成报告…</text>
    </view>

    <!-- 加载失败：可重试，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button v-if="needAnswering" class="action" @tap="handleGoAnswering">继续作答</button>
      <button class="action action--ghost" @tap="handleRetry">重试</button>
      <button class="action action--ghost" @tap="handleBackHome">返回首页</button>
    </view>

    <template v-else-if="report">
      <view class="header">
        <view class="header__title">{{ report.scaleName }}</view>
        <view v-if="submittedText" class="header__meta">完成于 {{ submittedText }}</view>
      </view>

      <view v-if="introText" class="intro">{{ introText }}</view>

      <!-- 低质量提示（B3/B4）：只提示可能受作答状态影响，不否定结果 -->
      <view v-if="report.lowQualityNotice" class="notice notice--warn">
        {{ report.lowQualityNotice }}
      </view>

      <!-- 底线题中性核实提示（B9）：不含关系判词（P7） -->
      <view v-if="report.baselineNotice" class="notice">{{ report.baselineNotice }}</view>

      <!-- 16 型人格图谱（scene=p16）：类型名 + 四维度端点 -->
      <view v-if="report.p16" class="card">
        <view class="p16">
          <view class="p16__type">{{ report.p16.typeName }}</view>
          <view class="p16__caption">你的四维取向组合</view>
        </view>
        <view v-for="dimension in report.p16.dimensions" :key="dimension.dimensionCode" class="row">
          <text class="row__label">{{ dimension.dimensionName }}</text>
          <text class="row__value">{{ poleText(dimension) }}</text>
        </view>
        <view class="hint">A / B 对应你在该组题目中更多选择的那一侧。</view>
      </view>

      <!-- 8 维度雷达图 + 一句话点评（简版报告免费内容） -->
      <template v-else>
        <view v-if="canDrawRadar" class="card">
          <RadarChart :items="radarItems" />
        </view>

        <view class="card">
          <view class="card__title">各维度解读</view>
          <view v-for="dimension in report.dimensions" :key="dimension.code" class="dim">
            <view class="dim__head">
              <text class="dim__name">{{ dimension.name }}</text>
              <text v-if="dimension.evaluated" class="dim__score">{{ dimension.score }}</text>
              <text v-else class="dim__score dim__score--muted">未评估</text>
            </view>
            <view v-if="dimension.supplemented" class="dim__tag">补测</view>
            <view v-if="commentByCode[dimension.code]" class="dim__text">
              {{ commentByCode[dimension.code] }}
            </view>
          </view>
        </view>
      </template>

      <!-- 付费墙锁定占位（价值感标准 §三）：只说明解锁后可获得的内容类别，不含内容本体 -->
      <view v-if="report.lockedHint" class="lock">
        <view class="lock__title">双人对比报告 · 未解锁</view>
        <view class="lock__text">{{ report.lockedHint }}</view>
      </view>

      <!-- 页脚固定免责声明（规格 2.3） -->
      <view class="disclaimer">{{ report.disclaimer }}</view>

      <button class="action action--ghost" @tap="handleBackHome">返回首页</button>
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

  &__text {
    font-size: $zb-font-size-base;
    color: $zb-color-text-secondary;
  }
}

.header {
  margin-bottom: 24rpx;

  &__title {
    font-size: $zb-font-size-report-title;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__meta {
    margin-top: 8rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.intro {
  margin-bottom: 24rpx;
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
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &__label {
    font-size: $zb-font-size-base;
    color: $zb-color-text-secondary;
  }

  &__value {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }
}

.notice {
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: $zb-color-text-secondary;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &--warn {
    color: $zb-color-warning;
  }
}

.p16 {
  margin-bottom: 16rpx;
  text-align: center;

  &__type {
    font-size: 56rpx;
    font-weight: 600;
    color: $zb-color-primary;
  }

  &__caption {
    margin-top: 8rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.hint {
  margin-top: 16rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: $zb-color-text-secondary;
}

.dim {
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  &__name {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__score {
    font-size: 30rpx;
    font-weight: 600;
    color: $zb-color-text;

    &--muted {
      font-size: $zb-font-size-base;
      font-weight: 400;
      color: $zb-color-text-secondary;
    }
  }

  &__tag {
    display: inline-block;
    padding: 2rpx 12rpx;
    margin-top: 8rpx;
    font-size: 22rpx;
    color: $zb-color-primary;
    background-color: rgba(232, 115, 74, 0.08);
    border-radius: 999rpx;
  }

  &__text {
    margin-top: 8rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.lock {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border: 2rpx dashed rgba(232, 115, 74, 0.4);
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 12rpx;
    font-size: 30rpx;
    font-weight: 600;
    color: $zb-color-primary;
  }

  &__text {
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.disclaimer {
  margin: 32rpx 0 16rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: $zb-color-text-secondary;
}

.action {
  margin-top: 16rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &--ghost {
    color: $zb-color-text-secondary;
    background-color: transparent;
  }

  &::after {
    border: none;
  }
}
</style>
