<script setup lang="ts">
/**
 * 邀请详情页（模块 5）
 *
 * 同一页面承载发起方与被邀请方两个视角（服务端按角色返回不同结构，见 docs/api.md §13.3），
 * 因为双方看到的是**同一条邀请的同一份状态**，分两个页面必然产生两份状态文案，迟早对不上。
 *
 * 发起方可用动作（服务端判定为准，端上只控制入口显隐）：
 *   分享卡片（对方未打开时）、提醒 TA（限 3 次）、续期 7 天（限 1 次，C4）、
 *   换人重邀（对方拒绝后，限 1 次，C7）、取消邀请、查看报告（L1）
 * 被邀请方可用动作：去同意 / 继续作答、查看报告（L2）
 *
 * 双方共有的数据控制动作（页面底部「数据管理」区块，ADR-011 决策 5）：
 *   查看本次配对的数据摘要 → 二次确认（逐条列出将删除 / 将保留 + 勾选联动）→ 物理删除；
 *   与发起方的「取消邀请」严格区分：取消只改状态、数据仍在，删除是物理删除且不可恢复。
 * 页面底部另有常驻弱入口「隐私与安全检查」（ADR-010 决策 4，无条件展示）。
 *
 * 报告等待（R6）：双方齐备后异步生成，本页在 `completed` 且报告未就绪时轮询，
 *   超时后停轮询并提示下拉刷新（避免长时间打满请求）。
 */
import { computed, onUnmounted, ref } from 'vue';
import { onLoad, onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app';
import { inviteApi } from '../../api/invite';
import { ApiErrorCode } from '../../constants/error-code';
import {
  ACTIVE_INVITE_STATUSES,
  CANCELLABLE_INVITE_STATUSES,
  DOUBLE_REPORT_PAGE_PATH,
  INVITE_ACCEPT_PAGE_PATH,
  INVITE_CODE_PATTERN,
  INVITE_DATA_MANAGEMENT_DESC,
  INVITE_DATA_MANAGEMENT_TITLE,
  INVITE_DATA_SUMMARY_ANSWER,
  INVITE_DATA_SUMMARY_LABELS,
  INVITE_DATA_SUMMARY_REPORT,
  INVITE_DELETE_DATA_BUTTON,
  INVITE_DELETE_MODAL_CANCEL_TEXT,
  INVITE_DELETE_MODAL_CHECKBOX_TEXT,
  INVITE_DELETE_MODAL_CONFIRM_TEXT,
  INVITE_DELETE_MODAL_SHARED_NOTE,
  INVITE_DELETE_MODAL_TITLE,
  INVITE_DELETE_MODAL_WILL_DELETE_ITEMS,
  INVITE_DELETE_MODAL_WILL_DELETE_TITLE,
  INVITE_DELETE_MODAL_WILL_KEEP_ITEMS,
  INVITE_DELETE_MODAL_WILL_KEEP_TITLE,
  INVITE_DELETE_SUCCESS_TOAST,
  INVITE_LIST_PAGE_PATH,
  INVITE_STATUS,
  INVITE_STATUS_FALLBACK_LABEL,
  INVITE_STATUS_LABELS,
  INVITE_TOAST_REDIRECT_DELAY_MS,
  REMINDABLE_INVITE_STATUSES,
  RENEWABLE_INVITE_STATUSES,
  REPORT_POLL_INTERVAL_MS,
  REPORT_POLL_MAX_ATTEMPTS,
  REPORT_STATUS,
} from '../../constants/invite';
import { SAFETY_ENTRY_TEXT, SAFETY_PAGE_PATH } from '../../constants/safety';
import type {
  InviteInitiatorView,
  InviteInviteeView,
  InviteView,
  ReportStatus,
} from '../../types/invite';
import { brandName } from '../../stores/app-config';
import { ensureLogin } from '../../utils/auth';
import { formatDate } from '../../utils/format';
import { ApiError } from '../../utils/request';

const code = ref('');
const loading = ref(true);
const errorText = ref('');
const view = ref<InviteView | null>(null);
/** 任一动作进行中：用于按钮 loading 与防重复点击 */
const acting = ref(false);
/** 报告轮询是否仍在进行（超出上限后置 false，页面提示改用手动刷新） */
const polling = ref(false);
/** 删除二次确认弹窗是否可见（自绘弹层，见 ADR-011 决策 5） */
const deleteModalVisible = ref(false);
/** 弹窗内「我已了解上述删除范围」勾选态：默认不勾，未勾选前确认按钮不可点 */
const deleteAgreed = ref(false);
/** 删除请求进行中：用于按钮 loading 与防重复提交 */
const deleting = ref(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAttempts = 0;

const initiator = computed<InviteInitiatorView | null>(() =>
  view.value?.role === 'initiator' ? view.value : null,
);
const invitee = computed<InviteInviteeView | null>(() =>
  view.value?.role === 'invitee' ? view.value : null,
);

const statusLabel = computed(() =>
  view.value ? INVITE_STATUS_LABELS[view.value.status] ?? INVITE_STATUS_FALLBACK_LABEL : '',
);

/** 状态说明（按角色区分：同一状态对双方意味着不同的事） */
const statusHint = computed(() => {
  const current = view.value;
  if (!current) return '';
  const initiatorHints: Record<string, string> = {
    [INVITE_STATUS.CREATED]: '把邀请卡片发给对方，TA 打开后就可以开始作答。',
    [INVITE_STATUS.OPENED]: '对方已打开邀请，正在确认知情同意。',
    [INVITE_STATUS.CONSENT_GIVEN]: '对方已同意，等待 TA 完成作答。',
    [INVITE_STATUS.ANSWERING]: '对方正在作答。',
    [INVITE_STATUS.COMPLETED]: '报告生成中，稍候片刻即可查看。',
    [INVITE_STATUS.REPORT_UNLOCKED]: '报告已就绪，可查看完整分析。',
    [INVITE_STATUS.EXPIRED]: '邀请已过期，可延长 7 天后继续。',
    [INVITE_STATUS.DECLINED]: '对方没有同意，你可以重新邀请其他人。',
    [INVITE_STATUS.CANCELLED]: '本次邀请已取消。',
  };
  const inviteeHints: Record<string, string> = {
    [INVITE_STATUS.CREATED]: '确认同意后即可开始作答。',
    [INVITE_STATUS.OPENED]: '确认同意后即可开始作答。',
    [INVITE_STATUS.CONSENT_GIVEN]: '你已经同意，接着完成作答就好。',
    [INVITE_STATUS.ANSWERING]: '接着完成作答就好。',
    [INVITE_STATUS.COMPLETED]: '你已提交，等对方提交后就能一起看到报告。',
    [INVITE_STATUS.REPORT_UNLOCKED]: '报告已就绪，可查看基础摘要。',
    [INVITE_STATUS.EXPIRED]: '邀请已过期，请让发起人延长有效期。',
    [INVITE_STATUS.DECLINED]: '你已拒绝本次邀请。',
    [INVITE_STATUS.CANCELLED]: '发起人已取消本次邀请。',
  };
  const table = current.role === 'initiator' ? initiatorHints : inviteeHints;
  return table[current.status] ?? '';
});

const reportReady = computed(() => view.value?.reportStatus === REPORT_STATUS.READY);
/** 双方已提交但报告尚未就绪（R6：此时才需要轮询） */
const waitingReport = computed(
  () => view.value?.status === INVITE_STATUS.COMPLETED && !reportReady.value,
);

/** 对方称谓：未绑定（对方还没打开）时不给昵称，避免看着像「有人已经参与」 */
const counterpart = computed(() => {
  const current = view.value;
  if (!current) return '';
  if (current.role === 'initiator') return current.inviteeNickname || '对方尚未打开';
  return current.initiatorNickname || '发起人';
});

/** 创建时间 / 完成时间：被邀请方视角不含这两个字段（无需知道邀请是何时建的） */
const createdAt = computed(() => initiator.value?.createdAt ?? null);
const completedAt = computed(() => initiator.value?.completedAt ?? null);

// ------------------------------------------------------------------ 动作入口显隐（服务端仍会再校验一遍）

/** 分享卡片：仅发起方，且对方尚未打开（已绑定后再分享，第三人打开只会得到「已被接受」） */
const canShare = computed(() => {
  const current = initiator.value;
  if (!current) return false;
  return !current.inviteeBound && ACTIVE_INVITE_STATUSES.includes(current.status);
});

const canRemind = computed(() => {
  const current = initiator.value;
  if (!current) return false;
  return (
    current.inviteeBound &&
    current.remindRemaining > 0 &&
    REMINDABLE_INVITE_STATUSES.includes(current.status)
  );
});

const canRenew = computed(() => {
  const current = initiator.value;
  if (!current) return false;
  return current.renewRemaining > 0 && RENEWABLE_INVITE_STATUSES.includes(current.status);
});

const canReplace = computed(() => initiator.value?.canReplace === true);

const canCancel = computed(() => {
  const current = initiator.value;
  if (!current) return false;
  return CANCELLABLE_INVITE_STATUSES.includes(current.status);
});

/** 被邀请方：可继续作答（已同意且尚未交卷） */
const canAnswer = computed(() => {
  const current = invitee.value;
  if (!current) return false;
  if (!current.consentGiven) return false;
  return current.status === INVITE_STATUS.CONSENT_GIVEN || current.status === INVITE_STATUS.ANSWERING;
});

/** 被邀请方：还没走到同意（或拒绝了重新进）→ 去入口页走同意 / 复用流程 */
const needConsent = computed(() => {
  const current = invitee.value;
  if (!current) return false;
  if (current.consentGiven) return false;
  return current.status === INVITE_STATUS.CREATED || current.status === INVITE_STATUS.OPENED;
});

// ------------------------------------------------------------------ 数据管理（ADR-011 决策 5）

/**
 * 数据摘要：删除前先让用户看清「这次配对里有什么」
 * 只用页面已有的 view 数据推导（不新增接口）：作答进度、报告状态、数据保留到期日。
 * 措辞要求中性客观，不带任何关系判词（P7 禁词红线）。
 */
const dataSummary = computed<{ label: string; value: string }[]>(() => {
  const current = view.value;
  if (!current) return [];
  return [
    { label: INVITE_DATA_SUMMARY_LABELS.ANSWER, value: answerSummary(current) },
    { label: INVITE_DATA_SUMMARY_LABELS.REPORT, value: reportSummary(current.reportStatus) },
    { label: INVITE_DATA_SUMMARY_LABELS.EXPIRE, value: formatDate(current.expireAt) },
  ];
});

/** 作答情况文案（按角色区分：双方看到的进度不同） */
function answerSummary(current: InviteView): string {
  const isInitiator = current.role === 'initiator';
  switch (current.status) {
    case INVITE_STATUS.CREATED:
    case INVITE_STATUS.OPENED:
      return isInitiator
        ? INVITE_DATA_SUMMARY_ANSWER.INITIATOR_NOT_STARTED
        : INVITE_DATA_SUMMARY_ANSWER.INVITEE_NOT_STARTED;
    case INVITE_STATUS.CONSENT_GIVEN:
    case INVITE_STATUS.ANSWERING:
      return isInitiator
        ? INVITE_DATA_SUMMARY_ANSWER.INITIATOR_ANSWERING
        : INVITE_DATA_SUMMARY_ANSWER.INVITEE_ANSWERING;
    case INVITE_STATUS.COMPLETED:
    case INVITE_STATUS.REPORT_UNLOCKED:
      return INVITE_DATA_SUMMARY_ANSWER.BOTH_SUBMITTED;
    default:
      return INVITE_DATA_SUMMARY_ANSWER.NOT_COMPLETED;
  }
}

/** 报告状态文案（未生成过 reportStatus 为 null） */
function reportSummary(status: ReportStatus | null): string {
  if (status === REPORT_STATUS.PENDING) return INVITE_DATA_SUMMARY_REPORT.PENDING;
  if (status === REPORT_STATUS.READY) return INVITE_DATA_SUMMARY_REPORT.READY;
  if (status === REPORT_STATUS.FAILED) return INVITE_DATA_SUMMARY_REPORT.FAILED;
  return INVITE_DATA_SUMMARY_REPORT.NONE;
}

function openDeleteModal(): void {
  deleteAgreed.value = false;
  deleteModalVisible.value = true;
}

function closeDeleteModal(): void {
  // 请求进行中不允许关闭，避免用户以为没删成功而重复操作
  if (deleting.value) return;
  deleteModalVisible.value = false;
}

/**
 * 删除本次配对数据（ADR-011）
 * 与同页的「取消邀请」无关：cancel 只改状态、数据仍在；本动作物理删除且不可恢复。
 */
async function handleDeleteData(): Promise<void> {
  if (!deleteAgreed.value || deleting.value) return;

  deleting.value = true;
  try {
    await inviteApi.deletePairingData(code.value);
    finishDelete();
  } catch (error) {
    // 404（10002）：记录已不存在（可能是对方先删了）。服务端与越权同码不区分，
    // 端上按「已删除」处理即可（幂等），不报错吓用户（ADR-011 决策 4）。
    if (error instanceof ApiError && error.code === ApiErrorCode.RESOURCE_NOT_FOUND) {
      finishDelete();
      return;
    }
    handleActionError(error);
  } finally {
    deleting.value = false;
  }
}

/** 删除完成后的统一出口：toast + 返回邀请列表页（本页数据已不存在，留下只会是空壳） */
function finishDelete(): void {
  deleteModalVisible.value = false;
  stopPolling();
  uni.showToast({ title: INVITE_DELETE_SUCCESS_TOAST, icon: 'none' });
  // 延迟跳转：立刻 redirectTo 会把 toast 一起带走，用户看不到提示
  setTimeout(() => {
    uni.redirectTo({ url: INVITE_LIST_PAGE_PATH });
  }, INVITE_TOAST_REDIRECT_DELAY_MS);
}

// ------------------------------------------------------------------ 生命周期

onLoad((options) => {
  const raw = ((options ?? {}) as Record<string, string>).code ?? '';
  const normalized = raw.trim().toLowerCase();
  if (!INVITE_CODE_PATTERN.test(normalized)) {
    loading.value = false;
    errorText.value = '邀请链接不完整或已失效';
    return;
  }
  code.value = normalized;
  void load();
});

onShow(() => {
  // 从答题页 / 报告页返回时刷新一次：对方可能刚刚交卷，状态与报告进度都会变
  if (code.value && view.value) void load();
});

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});

onUnmounted(() => {
  stopPolling();
});

/** 分享卡片：path 与服务端唯一登记（constants/invite.ts）一致 */
onShareAppMessage(() => ({
  title: `${brandName.value} · 邀请你一起做一份关系测评`,
  path: `${INVITE_ACCEPT_PAGE_PATH}?code=${code.value}`,
}));

async function load(): Promise<void> {
  errorText.value = '';

  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await inviteApi.open(code.value);
    view.value = result;
    syncPolling();
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 报告轮询（R6）

function syncPolling(): void {
  if (waitingReport.value) {
    startPolling();
    return;
  }
  stopPolling();
}

function startPolling(): void {
  if (pollTimer || polling.value) return;
  polling.value = true;
  pollAttempts = 0;
  scheduleNextPoll();
}

function scheduleNextPoll(): void {
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollReport();
  }, REPORT_POLL_INTERVAL_MS);
}

async function pollReport(): Promise<void> {
  pollAttempts += 1;
  try {
    const result = await inviteApi.open(code.value);
    view.value = result;
    if (result.reportStatus === REPORT_STATUS.READY) {
      stopPolling();
      return;
    }
  } catch {
    // 轮询期间的网络抖动不提示、不打断：下一轮继续尝试
  }

  if (pollAttempts >= REPORT_POLL_MAX_ATTEMPTS) {
    stopPolling();
    uni.showToast({ title: '报告还在生成中，稍后下拉刷新即可查看', icon: 'none' });
    return;
  }
  scheduleNextPoll();
}

function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  polling.value = false;
}

// ------------------------------------------------------------------ 发起方动作

async function handleRemind(): Promise<void> {
  const current = initiator.value;
  if (!current || acting.value) return;

  acting.value = true;
  try {
    const result = await inviteApi.remind(current.inviteId);
    uni.showToast({
      title: result.remindRemaining > 0 ? `已提醒，还可提醒 ${result.remindRemaining} 次` : '已提醒',
      icon: 'none',
    });
    await load();
  } catch (error) {
    handleActionError(error);
  } finally {
    acting.value = false;
  }
}

async function handleRenew(): Promise<void> {
  const current = initiator.value;
  if (!current || acting.value) return;

  acting.value = true;
  try {
    const updated = await inviteApi.renew(current.inviteId);
    view.value = updated;
    syncPolling();
    uni.showToast({ title: '已延长 7 天', icon: 'none' });
  } catch (error) {
    handleActionError(error);
  } finally {
    acting.value = false;
  }
}

async function handleReplace(): Promise<void> {
  const current = initiator.value;
  if (!current || acting.value) return;

  const confirmed = await confirmDialog('重新邀请其他人？', '原邀请将保留为「对方未同意」，本次机会用完后不能再换人。');
  if (!confirmed) return;

  acting.value = true;
  uni.showLoading({ title: '正在创建', mask: true });
  try {
    const result = await inviteApi.replace(current.inviteId);
    // 跳转到新邀请（原邀请已终结，留在旧页会让用户以为可以继续操作）
    uni.redirectTo({ url: `/pages/invite/detail?code=${result.code}` });
  } catch (error) {
    handleActionError(error);
  } finally {
    acting.value = false;
    uni.hideLoading();
  }
}

async function handleCancel(): Promise<void> {
  const current = initiator.value;
  if (!current || acting.value) return;

  const confirmed = await confirmDialog('取消本次邀请？', '取消后对方将无法继续作答，本次邀请不可恢复。');
  if (!confirmed) return;

  acting.value = true;
  try {
    const updated = await inviteApi.cancel(current.inviteId);
    view.value = updated;
    stopPolling();
    uni.showToast({ title: '已取消', icon: 'none' });
  } catch (error) {
    handleActionError(error);
  } finally {
    acting.value = false;
  }
}

// ------------------------------------------------------------------ 被邀请方动作

function handleAnswer(): void {
  uni.navigateTo({ url: `/pages/assessment/assessment?code=${code.value}` });
}

function handleGoConsent(): void {
  uni.navigateTo({ url: `${INVITE_ACCEPT_PAGE_PATH}?code=${code.value}` });
}

// ------------------------------------------------------------------ 公共

function handleViewReport(): void {
  uni.navigateTo({ url: `${DOUBLE_REPORT_PAGE_PATH}?code=${code.value}` });
}

/** 常驻弱入口：跳「隐私与安全检查」（ADR-010 决策 4，双人详情页无条件下展示） */
function handleOpenSafety(): void {
  uni.navigateTo({ url: SAFETY_PAGE_PATH });
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '加载失败，请重试';
  return '加载失败，请重试';
}

function handleActionError(error: unknown): void {
  if (error instanceof ApiError) {
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
  loading.value = true;
  void load();
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在加载邀请…</text>
    </view>

    <!-- 加载失败 / 链接异常：可重试，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button class="action" @tap="handleRetry">重试</button>
    </view>

    <template v-else-if="view">
      <view class="head">
        <view class="head__status">{{ statusLabel }}</view>
        <view class="head__hint">{{ statusHint }}</view>
      </view>

      <view class="card">
        <view class="row">
          <text class="row__label">量表版本</text>
          <text class="row__value">{{ view.scaleVersion }}</text>
        </view>
        <view class="row">
          <text class="row__label">{{ view.role === 'initiator' ? '被邀请人' : '发起人' }}</text>
          <text class="row__value">{{ counterpart }}</text>
        </view>
        <view v-if="createdAt" class="row">
          <text class="row__label">创建时间</text>
          <text class="row__value">{{ formatDate(createdAt) }}</text>
        </view>
        <view class="row">
          <text class="row__label">有效期至</text>
          <text class="row__value">{{ formatDate(view.expireAt) }}</text>
        </view>
        <view v-if="completedAt" class="row">
          <text class="row__label">完成时间</text>
          <text class="row__value">{{ formatDate(completedAt) }}</text>
        </view>
      </view>

      <!-- 报告生成中（R6）：轮询期间不阻塞其他内容，超时后转为手动刷新 -->
      <view v-if="waitingReport" class="notice">
        {{ polling ? '报告生成中，请稍候…' : '报告仍在生成中，下拉刷新即可查看' }}
      </view>

      <!-- 报告已就绪 -->
      <button v-if="reportReady" class="action" @tap="handleViewReport">
        {{ view.role === 'initiator' ? '查看完整报告' : '查看报告摘要' }}
      </button>

      <!-- 发起方动作 -->
      <template v-if="initiator">
        <button
          v-if="canShare"
          class="action"
          open-type="share"
        >
          分享邀请卡片
        </button>

        <button
          v-if="canRemind"
          class="action action--ghost"
          :loading="acting"
          :disabled="acting"
          @tap="handleRemind"
        >
          提醒 TA（还可 {{ initiator.remindRemaining }} 次）
        </button>

        <button
          v-if="canRenew"
          class="action action--ghost"
          :loading="acting"
          :disabled="acting"
          @tap="handleRenew"
        >
          延长有效期 7 天
        </button>

        <button
          v-if="canReplace"
          class="action"
          :loading="acting"
          :disabled="acting"
          @tap="handleReplace"
        >
          重新邀请其他人
        </button>

        <button
          v-if="canCancel"
          class="action action--ghost"
          :disabled="acting"
          @tap="handleCancel"
        >
          取消邀请
        </button>
      </template>

      <!-- 被邀请方动作 -->
      <template v-if="invitee">
        <button v-if="needConsent" class="action" @tap="handleGoConsent">去确认并开始</button>
        <button v-else-if="canAnswer" class="action" @tap="handleAnswer">继续作答</button>
      </template>

      <!--
        数据管理（ADR-011 决策 5）：双方视角都可见
        ⚠️ 与上面的「取消邀请」是两个动作，刻意分开：取消只改状态、数据仍在；删除是物理删除。
      -->
      <view class="card">
        <view class="card__title">{{ INVITE_DATA_MANAGEMENT_TITLE }}</view>
        <view class="card__desc">{{ INVITE_DATA_MANAGEMENT_DESC }}</view>
        <view v-for="row in dataSummary" :key="row.label" class="row">
          <text class="row__label">{{ row.label }}</text>
          <text class="row__value">{{ row.value }}</text>
        </view>
        <button
          class="action action--danger"
          :disabled="acting || deleting"
          @tap="openDeleteModal"
        >
          {{ INVITE_DELETE_DATA_BUTTON }}
        </button>
      </view>

      <!-- 常驻弱入口（ADR-010 决策 4）：与「数据管理」分开，不是数据动作 -->
      <view class="weak-entry" @tap="handleOpenSafety">{{ SAFETY_ENTRY_TEXT }}</view>
    </template>

    <!-- 删除二次确认弹窗（自绘：逐条清单 + 勾选联动，uni.showModal 承载不了） -->
    <view v-if="deleteModalVisible" class="mask">
      <view class="modal">
        <view class="modal__title">{{ INVITE_DELETE_MODAL_TITLE }}</view>

        <view class="modal__section">
          <view class="modal__section-title">{{ INVITE_DELETE_MODAL_WILL_DELETE_TITLE }}</view>
          <view
            v-for="item in INVITE_DELETE_MODAL_WILL_DELETE_ITEMS"
            :key="item"
            class="modal__item"
          >
            · {{ item }}
          </view>
        </view>

        <view class="modal__section">
          <view class="modal__section-title">{{ INVITE_DELETE_MODAL_WILL_KEEP_TITLE }}</view>
          <view
            v-for="item in INVITE_DELETE_MODAL_WILL_KEEP_ITEMS"
            :key="item"
            class="modal__item"
          >
            · {{ item }}
          </view>
        </view>

        <view class="modal__note">{{ INVITE_DELETE_MODAL_SHARED_NOTE }}</view>

        <view class="check" @tap="deleteAgreed = !deleteAgreed">
          <view class="check__box" :class="{ 'check__box--on': deleteAgreed }">
            <text v-if="deleteAgreed" class="check__tick">✓</text>
          </view>
          <text class="check__text">{{ INVITE_DELETE_MODAL_CHECKBOX_TEXT }}</text>
        </view>

        <button
          class="btn btn--danger"
          :loading="deleting"
          :disabled="!deleteAgreed || deleting"
          @tap="handleDeleteData"
        >
          {{ INVITE_DELETE_MODAL_CONFIRM_TEXT }}
        </button>
        <button class="btn btn--ghost" :disabled="deleting" @tap="closeDeleteModal">
          {{ INVITE_DELETE_MODAL_CANCEL_TEXT }}
        </button>
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

.head {
  margin-bottom: 32rpx;

  &__status {
    font-size: $zb-font-size-report-title;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__hint {
    margin-top: 12rpx;
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
    margin-bottom: 12rpx;
    font-size: 30rpx;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__desc {
    margin-bottom: 16rpx;
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
    max-width: 60%;
    font-size: 26rpx;
    color: $zb-color-text;
    text-align: right;
    word-break: break-all;
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

  /* 危险动作（删除本次配对数据）：用 $zb-color-danger，与「取消邀请」的视觉区分开 */
  &--danger {
    background-color: $zb-color-danger;
  }

  &::after {
    border: none;
  }
}

/* 常驻弱入口（ADR-010 决策 4）：小字文字链，刻意不与「数据管理」区块混在一起 */
.weak-entry {
  padding: 16rpx 0 32rpx;
  font-size: 24rpx;
  color: $zb-color-text-secondary;
  text-align: center;
  text-decoration: underline;
}

/* ------------------------------------------------------------------ 删除二次确认弹窗 */

.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background-color: rgba(43, 38, 34, 0.55);
}

.modal {
  width: 100%;
  max-height: 80vh;
  padding: 40rpx;
  overflow-y: auto;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 24rpx;
    font-size: 34rpx;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__section {
    margin-bottom: 24rpx;
  }

  &__section-title {
    margin-bottom: 8rpx;
    font-size: 26rpx;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__item {
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }

  /* 必含一句：删除后对方也看不到（说明这是双方共有物，不是只删自己那份） */
  &__note {
    padding: 16rpx 20rpx;
    margin-bottom: 16rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-danger;
    background-color: rgba(196, 85, 63, 0.08);
    border-radius: 8rpx;
  }
}

.check {
  display: flex;
  align-items: center;
  padding: 8rpx 0 8rpx;

  &__box {
    display: flex;
    flex-shrink: 0;
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

.btn {
  margin-top: 20rpx;
  font-size: 30rpx;

  &--danger {
    color: $zb-color-surface;
    background-color: $zb-color-danger;
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
