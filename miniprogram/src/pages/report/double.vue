<script setup lang="ts">
/**
 * 双人对比报告页（模块 5）
 *
 * 规格依据：
 *   - PRD-002 R3 三层可见：L1 完整版（发起方：雷达图 + 差值 + 待沟通 + 分歧）/ L2 基础版（被邀请方：纪念卡 + 共识区）
 *   - R2 逐题分歧、R5 底线题双向提示、R6 生成时机与轮询、D1 失败转人工
 *   - 规范增补 v0.2 §3.1 三层可见模型；docs/adr/ADR-005.md 决策 2（解读按差值档位）/ 决策 4（L3 由端上 canvas 合成）
 *
 * 关键实现约束：
 *   1. **层级由服务端按角色决定**（`level` 字段），端上不做任何可见性判断；
 *      L2 的响应里根本没有分值 / 差值字段（服务端在渲染前裁剪），故本页 L2 分支也不引用这些字段。
 *   2. 正文文案一律来自服务端模板（`blocks`），本页只负责按块键排版 —— 运营改文案零发版（宪法 P5）。
 *   3. 未评估维度（任一方拒绝授权，B7）绝不写 0 分：只列出维度名并给统一说明。
 *   4. 报告未就绪（pending）时轮询；超过上限停轮询并提示手动刷新（不打满请求）。
 */
import { computed, onUnmounted, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { inviteApi } from '../../api/invite';
import { topicApi } from '../../api/topic';
import RadarChart from '../../components/radar-chart/radar-chart.vue';
import { RADAR_MAX_DIMENSIONS } from '../../constants/assessment';
import {
  DOUBLE_BLOCK,
  INVITE_CODE_PATTERN,
  REPORT_POLL_INTERVAL_MS,
  REPORT_POLL_MAX_ATTEMPTS,
  REPORT_STATUS,
  SHARE_IMAGE_PAGE_PATH,
} from '../../constants/invite';
import { TOPIC_DETAIL_PAGE_PATH } from '../../constants/topic';
import type {
  DoubleFlaggedItem,
  DoubleReportL1View,
  DoubleReportL2View,
  InviteReportView,
} from '../../types/invite';
import type { RadarItem } from '../../types/assessment';
import type { TopicListItem } from '../../types/topic';
import { ensureLogin } from '../../utils/auth';
import { formatDate } from '../../utils/format';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
const code = ref('');
const report = ref<InviteReportView | null>(null);
/** 议题包清单（仅用于「待沟通区 → 议题包入口」，失败静默降级不影响报告阅读） */
const topics = ref<TopicListItem[]>([]);
/** 轮询是否仍在进行（超限后置 false，页面提示改用手动刷新） */
const polling = ref(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAttempts = 0;

/**
 * 已就绪的报告（未就绪时两者均为 null）
 * 判定方式说明：`pending` / `failed` 视图的 `status` 是联合类型（含 'ready'），
 *   单靠 `status === 'ready'` 无法让 TS 收窄；`inviteId` 只在两种就绪视图中存在，
 *   用它做判别键后 `level` 才能把类型收窄到 L1 / L2。
 */
const l1 = computed<DoubleReportL1View | null>(() => {
  const current = report.value;
  return current && 'inviteId' in current && current.level === 'L1' ? current : null;
});
const l2 = computed<DoubleReportL2View | null>(() => {
  const current = report.value;
  return current && 'inviteId' in current && current.level === 'L2' ? current : null;
});

/** 共识区条目（L1 / L2 都有，来自同一份快照比对结果） */
const consensusItems = computed(() => l1.value?.consensusItems ?? l2.value?.consensusItems ?? []);
/** 生成中 / 失败：服务端下发 message，端上不自己造文案 */
const pendingMessage = computed(() => {
  const current = report.value;
  if (!current || current.status === REPORT_STATUS.READY) return '';
  return current.message;
});
const failed = computed(() => report.value?.status === REPORT_STATUS.FAILED);

/** 块键 → 文案（模板可能只下发部分区块，缺块时静默跳过而不是留空白标题） */
const blockText = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  const blocks = l1.value?.blocks ?? l2.value?.blocks ?? [];
  for (const block of blocks) map[block.blockKey] = block.text;
  return map;
});

const generatedText = computed(() => formatDate(l1.value?.generatedAt ?? l2.value?.generatedAt ?? null, ''));

// ------------------------------------------------------------------ L1 数据派生

/** 双人雷达图：A = 本人、B = 对方（与分值口径一致，见 docs/api.md §13.9） */
const radarA = computed<RadarItem[]>(() =>
  (l1.value?.dimensions ?? []).map((row) => ({ label: row.dimensionName, value: row.scoreA })),
);
const radarB = computed<RadarItem[]>(() =>
  (l1.value?.dimensions ?? []).map((row) => ({ label: row.dimensionName, value: row.scoreB })),
);
const seriesLabels = computed(() =>
  l1.value ? { a: l1.value.selfNickname, b: l1.value.partnerNickname } : null,
);
const canDrawRadar = computed(
  () =>
    radarA.value.length >= 3 &&
    radarA.value.length <= RADAR_MAX_DIMENSIONS &&
    radarA.value.some((item) => item.value !== null),
);

/** 维度名查表（待沟通清单只给编码，需按编码取中文名展示） */
const dimensionNameByCode = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const row of l1.value?.dimensions ?? []) map[row.dimensionCode] = row.dimensionName;
  return map;
});

const pendingNames = computed(() =>
  (l1.value?.pendingCodes ?? []).map((dimensionCode) => dimensionNameByCode.value[dimensionCode] ?? dimensionCode),
);

/**
 * 待沟通维度对应的议题包入口（规范增补一 §三「报告中每个待沟通区 → 对应议题包入口」）
 *
 * 映射真源在服务端（`topic.mountDimensions`），端上只做「维度 ∈ 议题挂载维度」的筛选，
 *   不维护任何「维度 → 议题」对照表；L2 没有 `pendingCodes`，故被邀请方看不到该入口。
 */
const topicEntries = computed<TopicListItem[]>(() => {
  const codes = l1.value?.pendingCodes ?? [];
  if (codes.length === 0) return [];
  return topics.value.filter((topic) => topic.mountDimensions.some((code) => codes.includes(code)));
});

// ------------------------------------------------------------------ 生命周期

onLoad((options) => {
  const raw = ((options ?? {}) as Record<string, string>).code ?? '';
  const normalized = raw.trim().toLowerCase();
  if (!INVITE_CODE_PATTERN.test(normalized)) {
    loading.value = false;
    errorText.value = '报告链接不完整或已失效';
    return;
  }
  code.value = normalized;
  void load();
});

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});

onUnmounted(() => {
  stopPolling();
});

async function load(): Promise<void> {
  errorText.value = '';

  // A4：报告属登录后可见内容，未登录先引导登录
  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await inviteApi.getReport(code.value);
    report.value = result;
    uni.setNavigationBarTitle({ title: result.level === 'L2' ? '你们的结果' : '对比报告' });
    syncPolling();
    if (result.level === 'L1') void loadTopicEntries();
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * 拉议题包清单（供待沟通区反查入口）
 * 失败静默：报告的核心价值是结论本身，锦囊入口只是延伸阅读的加分项（A5 不出现死页）。
 */
async function loadTopicEntries(): Promise<void> {
  try {
    topics.value = await topicApi.list();
  } catch {
    topics.value = [];
  }
}

function openTopic(topicCode: string): void {
  uni.navigateTo({ url: `${TOPIC_DETAIL_PAGE_PATH}?code=${topicCode}` });
}

// ------------------------------------------------------------------ 轮询（R6）

function syncPolling(): void {
  if (report.value?.status === REPORT_STATUS.PENDING) {
    startPolling();
    return;
  }
  stopPolling();
}

function startPolling(): void {
  if (pollTimer || polling.value) return;
  polling.value = true;
  pollAttempts = 0;
  scheduleNext();
}

function scheduleNext(): void {
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollOnce();
  }, REPORT_POLL_INTERVAL_MS);
}

async function pollOnce(): Promise<void> {
  pollAttempts += 1;
  try {
    const result = await inviteApi.getReport(code.value);
    report.value = result;
    if (result.status === REPORT_STATUS.READY) {
      stopPolling();
      return;
    }
  } catch (error) {
    // 轮询期间出错不打断：若已明确未就绪则继续，其余错误按失败展示
    if (error instanceof ApiError && error.code !== 0) {
      errorText.value = describeError(error);
      stopPolling();
      return;
    }
  }

  if (pollAttempts >= REPORT_POLL_MAX_ATTEMPTS) {
    stopPolling();
    return;
  }
  scheduleNext();
}

function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  polling.value = false;
}

// ------------------------------------------------------------------ 展示辅助

/** 分歧项里单方的作答呈现：选择题给选项文案，量表题给分值，未作答时明确说明 */
function sideText(label: string | null, score: number | null): string {
  if (label) return label;
  if (typeof score === 'number') return `${score} 分`;
  return '未作答';
}

function dimensionLabel(item: DoubleFlaggedItem): string {
  return item.dimensionName ?? '';
}

function handleShareImage(): void {
  const current = l1.value;
  if (!current) return;
  // 带上 code：分享页需要 L1 的共识项清单做「可勾选」列表（R3：分享版默认仅共识区、可勾选）
  uni.navigateTo({
    url: `${SHARE_IMAGE_PAGE_PATH}?reportId=${current.reportId}&code=${code.value}`,
  });
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '报告加载失败，请重试';
  return '报告加载失败，请重试';
}

function handleRetry(): void {
  loading.value = true;
  void load();
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在生成报告…</text>
    </view>

    <!-- 加载失败：可重试，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button class="action" @tap="handleRetry">重试</button>
    </view>

    <!-- 生成中 / 失败（R6 / D1）：文案由服务端下发 -->
    <view v-else-if="pendingMessage" class="placeholder">
      <text class="placeholder__text">{{ pendingMessage }}</text>
      <text v-if="!failed && polling" class="placeholder__hint">正在自动刷新…</text>
      <text v-else-if="!failed" class="placeholder__hint">下拉即可刷新</text>
      <button class="action action--ghost" @tap="handleRetry">刷新</button>
    </view>

    <template v-else-if="l1 || l2">
      <view class="header">
        <view class="header__title">
          {{ (l1 ?? l2)?.selfNickname }} 与 {{ (l1 ?? l2)?.partnerNickname }}
        </view>
        <view v-if="generatedText" class="header__meta">生成于 {{ generatedText }}</view>
      </view>

      <view v-if="blockText[DOUBLE_BLOCK.INTRO]" class="intro">
        {{ blockText[DOUBLE_BLOCK.INTRO] }}
      </view>

      <!-- 底线题中性核实提示（R5）：双方同一文案，不含关系判词 -->
      <view v-if="(l1 ?? l2)?.baselineNotice" class="notice">
        {{ (l1 ?? l2)?.baselineNotice }}
      </view>

      <!-- ============================ L1 完整版（发起方） ============================ -->
      <template v-if="l1">
        <!-- 作答质量提示（C10）：不暴露是哪一方，L2 不含该字段 -->
        <view v-if="l1.lowQualityNotice" class="notice notice--warn">{{ l1.lowQualityNotice }}</view>

        <view class="card">
          <view v-if="blockText[DOUBLE_BLOCK.RADAR]" class="card__lead">
            {{ blockText[DOUBLE_BLOCK.RADAR] }}
          </view>
          <RadarChart
            v-if="canDrawRadar"
            :items="radarA"
            :items-b="radarB"
            :series-labels="seriesLabels"
          />
          <view v-else class="hint">本次可对比的维度不足，图形已省略，请看下方逐维度解读。</view>
        </view>

        <view class="card">
          <view class="card__title">维度对照</view>
          <view v-for="row in l1.dimensions" :key="row.dimensionCode" class="dim">
            <view class="dim__head">
              <text class="dim__name">{{ row.dimensionName }}</text>
              <text class="dim__level">{{ row.levelLabel }}</text>
            </view>
            <view class="dim__scores">
              <text class="dim__score">{{ l1.selfNickname }} {{ row.scoreA }}</text>
              <text class="dim__score">{{ l1.partnerNickname }} {{ row.scoreB }}</text>
              <text class="dim__gap">相差 {{ row.gap }}</text>
            </view>
            <view v-if="blockText[row.dimensionCode]" class="dim__text">
              {{ blockText[row.dimensionCode] }}
            </view>
          </view>

          <!-- 未评估维度（B7）：只标注，绝不写 0 分 -->
          <template v-if="l1.unevaluatedDimensions.length > 0">
            <view class="sub">未评估维度</view>
            <view class="chips">
              <text
                v-for="item in l1.unevaluatedDimensions"
                :key="item.dimensionCode"
                class="chip"
              >
                {{ item.dimensionName }}
              </text>
            </view>
            <view v-if="blockText[DOUBLE_BLOCK.UNEVALUATED]" class="hint">
              {{ blockText[DOUBLE_BLOCK.UNEVALUATED] }}
            </view>
          </template>
        </view>

        <!-- 待沟通区（R3：差值与待沟通清单只对发起方可见） -->
        <view v-if="pendingNames.length > 0" class="card">
          <view class="card__title">值得聊聊的地方</view>
          <view v-if="blockText[DOUBLE_BLOCK.PENDING]" class="card__lead">
            {{ blockText[DOUBLE_BLOCK.PENDING] }}
          </view>
          <view class="chips">
            <text v-for="name in pendingNames" :key="name" class="chip chip--warn">{{ name }}</text>
          </view>

          <!-- 待沟通区 → 议题包入口（规范增补一 §三）；映射来自服务端 mountDimensions -->
          <view v-if="topicEntries.length > 0" class="packs">
            <view class="packs__title">这些话题有专门的锦囊</view>
            <view
              v-for="topic in topicEntries"
              :key="topic.code"
              class="packs__item"
              @tap="openTopic(topic.code)"
            >
              <text class="packs__name">{{ topic.title }}</text>
              <text v-if="topic.subtitle" class="packs__subtitle">{{ topic.subtitle }}</text>
            </view>
          </view>
        </view>

        <!-- 逐题分歧（R2） -->
        <view v-if="l1.divergenceItems.length > 0" class="card">
          <view class="card__title">具体分歧</view>
          <view v-if="blockText[DOUBLE_BLOCK.DIVERGENCE]" class="card__lead">
            {{ blockText[DOUBLE_BLOCK.DIVERGENCE] }}
          </view>
          <view v-for="(item, index) in l1.divergenceItems" :key="`${item.questionCode}-${index}`" class="flag">
            <view class="flag__q">{{ item.questionTitle }}</view>
            <view class="flag__a">
              <text class="flag__side">{{ l1.selfNickname }}「{{ sideText(item.optionLabelA, item.scoreA) }}」</text>
              <text class="flag__side">{{ l1.partnerNickname }}「{{ sideText(item.optionLabelB, item.scoreB) }}」</text>
            </view>
            <view v-if="dimensionLabel(item)" class="flag__dim">{{ dimensionLabel(item) }}</view>
          </view>
        </view>
      </template>

      <!-- ============================ L2 基础版（被邀请方） ============================ -->
      <template v-else-if="l2">
        <view v-if="blockText[DOUBLE_BLOCK.MEMORY_CARD]" class="card">
          <view class="memory">{{ blockText[DOUBLE_BLOCK.MEMORY_CARD] }}</view>
        </view>
      </template>

      <!-- 共识区（L1 / L2 都有）：题目双方作答一致，本身不构成信息泄露（R4） -->
      <view v-if="consensusItems.length > 0" class="card">
        <view class="card__title">你们的共识</view>
        <view v-if="blockText[DOUBLE_BLOCK.CONSENSUS]" class="card__lead">
          {{ blockText[DOUBLE_BLOCK.CONSENSUS] }}
        </view>
        <view v-for="item in consensusItems" :key="item.questionCode" class="agree">
          <view class="agree__q">{{ item.questionTitle }}</view>
          <view class="agree__a">{{ item.optionLabel }}</view>
        </view>
      </view>

      <!-- 沟通引导 / 结尾（L1）；L2 的「想和你聊聊」入口 -->
      <view v-if="l1 && blockText[DOUBLE_BLOCK.TALK_GUIDE]" class="card">
        <view class="card__text">{{ blockText[DOUBLE_BLOCK.TALK_GUIDE] }}</view>
      </view>
      <view v-if="l2 && blockText[DOUBLE_BLOCK.TALK_ENTRY]" class="card">
        <view class="card__text">{{ blockText[DOUBLE_BLOCK.TALK_ENTRY] }}</view>
      </view>
      <view v-if="l1 && blockText[DOUBLE_BLOCK.ENDING]" class="card">
        <view class="card__text">{{ blockText[DOUBLE_BLOCK.ENDING] }}</view>
      </view>

      <!-- L3 分享长图（仅发起方，R3：默认仅共识区） -->
      <button v-if="l1" class="action" @tap="handleShareImage">生成分享长图</button>

      <view class="disclaimer">{{ (l1 ?? l2)?.disclaimer }}</view>
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
    font-size: $zb-font-size-base;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }

  &__hint {
    margin-top: 12rpx;
    font-size: 24rpx;
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

  &__lead {
    margin-bottom: 16rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }

  &__text {
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
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

.hint {
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: $zb-color-text-secondary;
}

.sub {
  margin-top: 24rpx;
  margin-bottom: 12rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: $zb-color-text;
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

  &__level {
    font-size: 24rpx;
    color: $zb-color-primary;
  }

  &__scores {
    display: flex;
    margin-top: 8rpx;
  }

  &__score,
  &__gap {
    margin-right: 24rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__text {
    margin-top: 12rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.chips {
  display: flex;
  flex-wrap: wrap;
}

.chip {
  padding: 6rpx 18rpx;
  margin: 0 12rpx 12rpx 0;
  font-size: 24rpx;
  color: $zb-color-text-secondary;
  background-color: rgba(138, 128, 120, 0.1);
  border-radius: 999rpx;

  &--warn {
    color: $zb-color-warning;
    background-color: rgba(217, 164, 65, 0.12);
  }
}

.packs {
  margin-top: 16rpx;

  &__title {
    margin-bottom: 12rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__item {
    display: flex;
    align-items: baseline;
    padding: 16rpx 0;
    border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

    &:last-child {
      border-bottom: none;
    }

    &:active {
      opacity: 0.7;
    }
  }

  &__name {
    font-size: $zb-font-size-base;
    color: $zb-color-primary;
  }

  &__subtitle {
    flex: 1;
    margin-left: 16rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.flag {
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__q {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__a {
    display: flex;
    flex-wrap: wrap;
    margin-top: 8rpx;
  }

  &__side {
    margin-right: 24rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__dim {
    margin-top: 8rpx;
    font-size: 22rpx;
    color: $zb-color-text-secondary;
  }
}

.agree {
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__q {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__a {
    margin-top: 8rpx;
    font-size: 26rpx;
    color: $zb-color-success;
  }
}

.memory {
  font-size: 30rpx;
  line-height: 1.8;
  color: $zb-color-text;
  text-align: center;
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
