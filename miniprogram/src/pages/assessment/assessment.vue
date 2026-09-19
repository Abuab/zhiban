<script setup lang="ts">
/**
 * 答题页（模块 4：单人测评流程；模块 5 扩展：邀请卷）
 *
 * 覆盖 prompt.md 模块 4 的答题流程要求：
 *   - B1 断点续答：进入即调 start（有草稿则续答），卷首展示「继续上次（已完成 X/Y 题）」
 *   - B2 弱网/提交失败：答案实时落本地缓存，联网自动补传；提交按钮防重复点击
 *   - B3/B4 低质量：作答时长由本页统计后随交卷上报（是否标记由服务端规则判定）
 *   - B5 交卷后锁定：本页只对 draft 状态开放编辑
 *   - B7 敏感维度前置同意：进入敏感维度前单独弹窗征得同意，拒绝则跳过该维度
 *   - A3 多端乐观锁：保存/交卷携带 draftVersion，冲突（30004）时拉取服务端最新答案
 *   - A4 未登录：先引导登录（ensureLogin），登录后回到本页
 *   - G1 进行中不受影响：题目与卷首文案取自答题卷锁定的量表版本（服务端保证）
 *
 * 模块 5 邀请卷（`?code=<邀请码>`）与单人卷**共用本页**，差异只在四处数据出入口
 *   （开卷 / 存草稿 / 冲突重拉 / 交卷），故以 `inviteCode` 分支而不是复制一整个页面：
 *   答题交互、敏感维度同意、断点续答、本地缓存的实现完全相同，复制会产生两份必须同步维护的代码。
 *   交卷后邀请卷不回简版报告页（对比报告双方齐备才生成），而是回邀请详情页看状态（R6）。
 *
 * 交互：单题一屏（UX-001 §4.3「每屏一个视觉焦点」），顶部进度条 + 「第 N 题 / 共 M 题」（§4.3.1 进度感）。
 */
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { assessmentApi } from '../../api/assessment';
import { inviteApi } from '../../api/invite';
import QuestionItem from '../../components/question-item/question-item.vue';
import { SCENE_P16, buildSkippedSummaryText } from '../../constants/assessment';
import { ApiErrorCode } from '../../constants/error-code';
import { INVITE_CODE_PATTERN, INVITE_DETAIL_PAGE_PATH } from '../../constants/invite';
import type {
  AssessmentDetail,
  PaperDimension,
  PaperQuestion,
  StartableScene,
} from '../../types/assessment';
import { assessmentDraft } from '../../utils/assessment-draft';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

/** 答案保存防抖（毫秒）：避免连续点选触发过多请求 */
const SAVE_DEBOUNCE_MS = 600;
/** 选中选项后自动翻到下一题的延迟（毫秒） */
const AUTO_ADVANCE_MS = 220;

const scene = ref<StartableScene>('single');
/**
 * 邀请码（非空 = 邀请卷）
 * 邀请卷的量表版本由邀请创建时冻结（B8），故不再传 scene —— 场景由服务端按邀请决定。
 */
const inviteCode = ref('');
const loading = ref(true);
const errorText = ref('');
const detail = ref<AssessmentDetail | null>(null);
/** intro 展示卷首作答说明；answering 为答题态 */
const stage = ref<'intro' | 'answering'>('intro');

const answers = ref<Record<string, number | string>>({});
const skippedDimensions = ref<string[]>([]);
/**
 * 逐题「不愿回答」的题号（ADR-013 决策 7）
 * 与 skippedDimensions 是两种不同的产品动作，且**互斥**：
 *   整维跳过 = 未授权该维度的私密内容（B7 弹窗选「不同意」）；
 *   逐题跳过 = 已授权，只是个别题不愿答。
 * 同一维度不得同时存在于两个集合，否则服务端按 10001 拒绝整个请求。
 */
const skippedQuestions = ref<string[]>([]);
const draftVersion = ref(0);
/** 已表态的敏感维度（同意或跳过），避免反复弹窗 */
const decidedDimensions = ref<string[]>([]);

const questionIndex = ref(0);
const submitting = ref(false);
/** 同步状态：pending = 本地有未同步改动（弱网），联网后自动补传 */
const syncState = ref<'idle' | 'pending'>('idle');

/** 敏感维度同意弹窗：非空时展示 */
const consentDimension = ref<PaperDimension | null>(null);
/** 同意弹窗待跳转的题目下标（确认后跳过去） */
const consentTargetIndex = ref(0);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;

/** 作答计时（毫秒）：只统计停留在答题态的时间，中途退出不计入 */
let accumulatedMs = 0;
let activeSince: number | null = null;

const paper = computed(() => detail.value?.paper ?? null);
const sheetId = computed(() => detail.value?.sheet.id ?? 0);
/** 是否为邀请卷（模块 5）：决定开卷 / 存草稿 / 交卷走哪套接口 */
const isInviteMode = computed(() => inviteCode.value.length > 0);
/**
 * 交卷按钮文案
 * 邀请卷交卷后不一定马上有报告（对方未交卷则无报告，R6 双方齐备才生成），
 * 故不能承诺「查看报告」，只承诺「提交」。
 */
const submitLabel = computed(() => (isInviteMode.value ? '提交我的作答' : '提交并查看报告'));

/** 被整维跳过的维度所覆盖的题号（B7；由 skippedDimensions 展开） */
const dimensionSkippedCodes = computed(() => {
  const skipped = new Set(skippedDimensions.value);
  const codes = new Set<string>();
  for (const question of paper.value?.questions ?? []) {
    if (question.dimensionCode && skipped.has(question.dimensionCode)) codes.add(question.code);
  }
  return codes;
});

/**
 * 可访问的题目（剔除被整维跳过的维度）
 * 该序列同时是**导航序列**：逐题跳过的题仍留在其中，用户可回到它「改主意」（ADR-013 决策 7）
 */
const activeQuestions = computed<PaperQuestion[]>(() =>
  (paper.value?.questions ?? []).filter((question) => !dimensionSkippedCodes.value.has(question.code)),
);

/** 导航序列长度：上一题 / 下一题 / 是否最后一屏都以它为准（不要用进度分母） */
const navigationTotal = computed(() => activeQuestions.value.length);

/**
 * 进度分母序列（ADR-013 决策 7 / 决策 2）
 * 整维跳过与逐题跳过的题号**都不计入分母**，与服务端 buildProgress 口径一致；
 * 进度条、「已完成 X / Y 题」、交卷完整性判定、传给单题组件的总题数全部用它。
 */
const progressQuestions = computed<PaperQuestion[]>(() =>
  activeQuestions.value.filter((question) => !skippedQuestions.value.includes(question.code)),
);

const total = computed(() => progressQuestions.value.length);
const currentQuestion = computed<PaperQuestion | null>(() => activeQuestions.value[questionIndex.value] ?? null);
const answeredCount = computed(
  () => progressQuestions.value.filter((question) => answers.value[question.code] !== undefined).length,
);
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((answeredCount.value / total.value) * 100),
);
const missingCount = computed(() => total.value - answeredCount.value);
const isComplete = computed(() => total.value > 0 && missingCount.value === 0);
const isLastQuestion = computed(() => questionIndex.value >= navigationTotal.value - 1);

/** 当前题是否已被逐题跳过（该题不显示序号，也不参与进度分母） */
const isCurrentSkipped = computed(() => {
  const question = currentQuestion.value;
  return question !== null && skippedQuestions.value.includes(question.code);
});

/** 当前题在进度序列中的序号；被跳过的题不在序列中，返回 0（组件按「已跳过」态隐藏序号区域） */
const currentOrder = computed(() => {
  const code = currentQuestion.value?.code;
  if (!code) return 0;
  const index = progressQuestions.value.findIndex((question) => question.code === code);
  return index === -1 ? 0 : index + 1;
});

/**
 * 是否展示敏感题提示条（ADR-013 决策 7）
 * activeQuestions 已剔除整维跳过的维度，故「该维度未被整维跳过」由序列本身保证，此处只判敏感维度。
 */
const showSensitiveHint = computed(() => {
  const question = currentQuestion.value;
  if (!question?.dimensionCode) return false;
  const dimension = paper.value?.dimensions.find((item) => item.code === question.dimensionCode);
  return dimension?.isSensitive === true;
});

/** 交卷前的中性提示（ADR-013 决策 7）：只陈述事实，不含任何关系判词（P7） */
const skippedSummaryText = computed(() =>
  skippedQuestions.value.length > 0 ? buildSkippedSummaryText(skippedQuestions.value.length) : '',
);

/** 底线题组卷首：进入底线题组的第一题时展示（规格 L406-408「独立呈现」） */
const showBaselineIntro = computed(() => {
  const question = currentQuestion.value;
  if (!question?.isBaseline || !paper.value?.baselineIntroText) return false;
  const previous = activeQuestions.value[questionIndex.value - 1];
  return !previous || !previous.isBaseline;
});

/** 当前题所属的敏感维度（需前置同意，B7） */
const pendingConsentDimension = computed<PaperDimension | null>(() => {
  const question = currentQuestion.value;
  if (!question?.dimensionCode) return null;
  const dimension = paper.value?.dimensions.find((item) => item.code === question.dimensionCode);
  if (!dimension?.isSensitive) return null;
  if (decidedDimensions.value.includes(dimension.code)) return null;
  return dimension;
});

// ------------------------------------------------------------------ 生命周期

onLoad((options) => {
  const params = (options ?? {}) as Record<string, string>;

  // 邀请卷优先：`?code=<邀请码>` 由分享卡片或邀请详情页带入
  const rawCode = (params.code ?? '').trim().toLowerCase();
  if (rawCode) {
    // 提前做格式校验：邀请码格式不符时服务端必然 404，没必要先登录再吃一次失败
    if (!INVITE_CODE_PATTERN.test(rawCode)) {
      loading.value = false;
      errorText.value = '邀请链接不完整或已失效';
      return;
    }
    inviteCode.value = rawCode;
    void init();
    return;
  }

  scene.value = params.scene === SCENE_P16 ? SCENE_P16 : 'single';
  void init();
});

onShow(() => {
  // 从后台返回：继续计时，并补传本地未同步的答案（B2）
  if (stage.value === 'answering' && activeSince === null) activeSince = Date.now();
  if (syncState.value === 'pending') void saveDraft();
});

onHide(() => {
  pauseTimer();
  // 切后台立即落盘（含本地缓存），避免杀进程丢答案
  persistLocal(syncState.value === 'pending');
  void saveDraft();
});

onUnload(() => {
  pauseTimer();
  clearTimers();
  persistLocal(syncState.value === 'pending');
});

// ------------------------------------------------------------------ 初始化

async function init(): Promise<void> {
  loading.value = true;
  errorText.value = '';

  // A4：测评需要登录态，未登录先引导登录（登录后回到本页重新初始化）
  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await loadDetail();
    applyDetail(result, true);
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * 开卷取数
 * 邀请卷走邀请域（服务端「先建卷再渲染」，幂等，C3 复用与状态推进都在服务端判定），
 * 单人卷走测评域 start；两者返回结构一致（`AssessmentDetail`），故后续流程完全共用。
 */
function loadDetail(): Promise<AssessmentDetail> {
  return isInviteMode.value
    ? inviteApi.openSheet(inviteCode.value)
    : assessmentApi.start(scene.value);
}

/**
 * 应用服务端答题卷数据
 * @param mergeLocal 是否合并本地未同步的答案（B2：弱网期间答的题在联网后补传）
 */
function applyDetail(result: AssessmentDetail, mergeLocal: boolean): void {
  detail.value = result;

  const local = mergeLocal ? assessmentDraft.load(result.sheet.id) : null;
  const useLocal = local?.pendingSync === true;

  answers.value = useLocal ? { ...result.sheet.answers, ...local.answers } : { ...result.sheet.answers };
  skippedDimensions.value = useLocal ? local.skippedDimensions : [...result.sheet.skippedDimensions];
  // 本地未同步的逐题跳过优先（用户离线点的「不愿回答」不能因重进页面而丢失）
  skippedQuestions.value = useLocal ? local.skippedQuestions : [...result.sheet.skippedQuestionCodes];
  draftVersion.value = result.sheet.draftVersion;
  syncState.value = useLocal ? 'pending' : 'idle';

  // 已表态的敏感维度：被跳过的 + 已有答案的（续答时不再重复弹窗）
  const answeredDimensions = new Set(
    (result.paper.questions ?? [])
      .filter((question) => answers.value[question.code] !== undefined)
      .map((question) => question.dimensionCode)
      .filter((code): code is string => code !== null),
  );
  decidedDimensions.value = [
    ...new Set([...skippedDimensions.value, ...answeredDimensions]),
  ];

  // 导航栏标题取量表名（服务端下发，不硬编码）
  uni.setNavigationBarTitle({ title: result.paper.scaleName });

  if (useLocal) void saveDraft();
}

// ------------------------------------------------------------------ 作答

function handleStart(): void {
  startAnswering();
}

function startAnswering(): void {
  stage.value = 'answering';
  // 定位到第一道未答题（B1 续答体验）
  questionIndex.value = Math.max(0, firstMissingIndex());
  activeSince = Date.now();
  if (pendingConsentDimension.value) requestSensitiveConsent();
}

function handleSelect(value: number | string): void {
  const question = currentQuestion.value;
  if (!question) return;

  answers.value = { ...answers.value, [question.code]: value };
  persistLocal(true);
  scheduleSave();

  if (!isLastQuestion.value) {
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      goTo(questionIndex.value + 1);
    }, AUTO_ADVANCE_MS);
  }
}

function handlePrevious(): void {
  if (questionIndex.value > 0) goTo(questionIndex.value - 1);
}

function handleNext(): void {
  if (!isLastQuestion.value) goTo(questionIndex.value + 1);
}

function goTo(target: number): void {
  // 边界按导航序列算：被逐题跳过的题仍在序列里，允许回来改主意（ADR-013 决策 7）
  const clamped = Math.min(Math.max(target, 0), Math.max(navigationTotal.value - 1, 0));
  questionIndex.value = clamped;
  // 进入敏感维度前先征得同意（B7）；拒绝则跳过该维度并重新定位
  if (pendingConsentDimension.value) requestSensitiveConsent();
}

/**
 * 第一道「需要作答但还没有答案」的题
 * 被逐题跳过的题不算缺失（ADR-013 决策 6：跳过不阻塞交卷），否则「去补答」会跳到用户明确拒绝的题上
 */
function firstMissingIndex(): number {
  const index = activeQuestions.value.findIndex(
    (question) =>
      !skippedQuestions.value.includes(question.code) && answers.value[question.code] === undefined,
  );
  return index === -1 ? 0 : index;
}

function handleJumpToMissing(): void {
  goTo(firstMissingIndex());
}

// ------------------------------------------------------------------ 逐题「不愿回答」（ADR-013 决策 7）

/** 点「不愿回答」：记题号 → 丢弃该题答案 → 落本地 + 存草稿 → 自动跳下一题 */
function handleSkipQuestion(): void {
  const question = currentQuestion.value;
  if (!question) return;

  skippedQuestions.value = [...new Set([...skippedQuestions.value, question.code])];
  // 服务端对被跳过题号一律丢弃答案，端上同步剔除，避免本地留下「已答但被判跳过」的脏状态
  const rest = { ...answers.value };
  delete rest[question.code];
  answers.value = rest;

  persistLocal(true);
  // 沿用防抖保存：连续跳过不会并发提交同一个 draftVersion（否则乐观锁冲突会把本地状态整体回滚）
  scheduleSave();

  if (!isLastQuestion.value) goTo(questionIndex.value + 1);
}

/** 点「改主意，回答这题」：从跳过集合移除即恢复选项，状态随下次草稿提交同步 */
function handleUnskipQuestion(): void {
  const question = currentQuestion.value;
  if (!question) return;
  skippedQuestions.value = skippedQuestions.value.filter((code) => code !== question.code);
  persistLocal(true);
  scheduleSave();
}

// ------------------------------------------------------------------ 敏感维度同意（B7）

/** 弹窗同意与否都由用户显式选择，不存在默认同意 */
function requestSensitiveConsent(): void {
  consentTargetIndex.value = questionIndex.value;
  consentDimension.value = pendingConsentDimension.value;
}

function handleConsentAgree(): void {
  const dimension = consentDimension.value;
  if (dimension) decidedDimensions.value = [...decidedDimensions.value, dimension.code];
  consentDimension.value = null;
}

function handleConsentSkip(): void {
  const dimension = consentDimension.value;
  consentDimension.value = null;
  if (!dimension) return;

  decidedDimensions.value = [...decidedDimensions.value, dimension.code];
  skippedDimensions.value = [...new Set([...skippedDimensions.value, dimension.code])];
  // 两套跳过集合互斥（ADR-013 决策 1）：整维跳过时清掉该维度内已有的逐题跳过，
  // 否则同一维度同时出现在两个集合里，服务端会按 10001 拒绝保存/交卷，用户会卡住
  const codesInDimension = new Set(
    (paper.value?.questions ?? [])
      .filter((question) => question.dimensionCode === dimension.code)
      .map((question) => question.code),
  );
  skippedQuestions.value = skippedQuestions.value.filter((code) => !codesInDimension.has(code));
  persistLocal(true);
  questionIndex.value = Math.min(consentTargetIndex.value, Math.max(activeQuestions.value.length - 1, 0));
  void saveDraft();
}

// ------------------------------------------------------------------ 保存与交卷

/** 本地缓存（B2：即使保存接口失败，答案也不会丢） */
function persistLocal(pendingSync: boolean): void {
  if (!sheetId.value) return;
  assessmentDraft.save({
    sheetId: sheetId.value,
    baseVersion: draftVersion.value,
    answers: answers.value,
    skippedDimensions: skippedDimensions.value,
    skippedQuestions: skippedQuestions.value,
    pendingSync,
  });
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveDraft();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * 保存草稿到服务端
 * 失败不打断作答：标记 pending 并保留本地缓存，联网或下次作答时自动补传（B2）
 */
async function saveDraft(): Promise<void> {
  if (!sheetId.value || !detail.value || detail.value.sheet.status !== 'draft') return;

  const payload = {
    draftVersion: draftVersion.value,
    answers: answers.value,
    skippedDimensions: skippedDimensions.value,
    // 单人卷与邀请卷复用同一份 payload，逐题跳过集合只在这里组装一次（ADR-013 决策 1）
    skippedQuestionCodes: skippedQuestions.value,
  };

  try {
    // 邀请卷的卷 id 由邀请码隐含，路径里不带 sheetId（防止跨邀请串改别人的卷）
    const result = isInviteMode.value
      ? await inviteApi.saveDraft(inviteCode.value, payload)
      : await assessmentApi.saveDraft(sheetId.value, payload);
    draftVersion.value = result.draftVersion;
    syncState.value = 'idle';
    assessmentDraft.markSynced(sheetId.value, result.draftVersion);
  } catch (error) {
    if (error instanceof ApiError && error.code === ApiErrorCode.ANSWER_DRAFT_CONFLICT) {
      // A3：另一端已改过 → 以服务端为准重新拉取，本地未同步改动丢弃并提示
      await reloadAfterConflict();
      return;
    }
    if (error instanceof ApiError && error.code === ApiErrorCode.ANSWER_LOCKED) {
      // B5：已交卷 → 直接去报告
      redirectToReport();
      return;
    }
    syncState.value = 'pending';
    persistLocal(true);
  }
}

async function reloadAfterConflict(): Promise<void> {
  try {
    const fresh = await loadDetail();
    applyDetail(fresh, false);
    uni.showToast({ title: '答案已在其他设备更新，已为你同步最新进度', icon: 'none' });
  } catch (error) {
    errorText.value = describeError(error);
  }
}

/** 交卷（B2：按钮防重复点击；B5：交卷后答案锁定） */
async function handleSubmit(): Promise<void> {
  if (submitting.value) return;
  if (!isComplete.value) {
    handleJumpToMissing();
    return;
  }

  submitting.value = true;
  uni.showLoading({ title: '正在生成报告', mask: true });
  try {
    // 先补一次草稿，保证服务端拿到最新答案（若之前处于弱网 pending）
    if (syncState.value === 'pending') await saveDraft();
    if (syncState.value === 'pending') {
      uni.showToast({ title: '网络不稳定，答案已保存在本机，请稍后重试', icon: 'none' });
      return;
    }

    const durationSec = currentDurationSec();
    const input = {
      draftVersion: draftVersion.value,
      answers: answers.value,
      skippedDimensions: skippedDimensions.value,
      // 被跳过的题不阻塞交卷（ADR-013 决策 6）：交卷入参同样带上逐题跳过集合
      skippedQuestionCodes: skippedQuestions.value,
      durationSec,
    };

    if (isInviteMode.value) {
      // 邀请卷：交卷即冻结本人快照；对方未交卷时还没有报告（R6），故回详情页看状态
      await inviteApi.submit(inviteCode.value, input);
      assessmentDraft.markSubmitted(sheetId.value);
      uni.redirectTo({ url: `${INVITE_DETAIL_PAGE_PATH}?code=${inviteCode.value}` });
      return;
    }

    const report = await assessmentApi.submit(sheetId.value, input);
    assessmentDraft.markSubmitted(sheetId.value);
    uni.redirectTo({ url: `/pages/report/report?sheetId=${report.sheetId}` });
  } catch (error) {
    handleSubmitError(error);
  } finally {
    submitting.value = false;
    uni.hideLoading();
  }
}

function handleSubmitError(error: unknown): void {
  if (!(error instanceof ApiError)) {
    uni.showToast({ title: '提交失败，请重试', icon: 'none' });
    return;
  }
  if (error.code === ApiErrorCode.ANSWER_INCOMPLETE) {
    uni.showToast({ title: error.message, icon: 'none' });
    handleJumpToMissing();
    return;
  }
  if (error.code === ApiErrorCode.ANSWER_DRAFT_CONFLICT) {
    void reloadAfterConflict();
    return;
  }
  if (error.code === ApiErrorCode.ANSWER_LOCKED) {
    redirectToReport();
    return;
  }
  uni.showToast({ title: error.message || '提交失败，请重试', icon: 'none' });
}

function redirectToReport(): void {
  if (!sheetId.value) return;
  // 邀请卷不回简版报告页：对比报告在邀请详情页按角色进入（发起方 L1 / 被邀请方 L2）
  if (isInviteMode.value) {
    uni.redirectTo({ url: `${INVITE_DETAIL_PAGE_PATH}?code=${inviteCode.value}` });
    return;
  }
  uni.redirectTo({ url: `/pages/report/report?sheetId=${sheetId.value}` });
}

// ------------------------------------------------------------------ 计时

function pauseTimer(): void {
  if (activeSince !== null) {
    accumulatedMs += Date.now() - activeSince;
    activeSince = null;
  }
}

function currentDurationSec(): number {
  const running = activeSince === null ? 0 : Date.now() - activeSince;
  return Math.max(0, Math.round((accumulatedMs + running) / 1000));
}

function clearTimers(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
}

// ------------------------------------------------------------------ 文案

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '加载失败，请重试';
  return '加载失败，请重试';
}

function handleRetry(): void {
  void init();
}

function handleBackHome(): void {
  uni.reLaunch({ url: '/pages/index/index' });
}
</script>

<template>
  <view class="page">
    <!-- 加载中 -->
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在准备题目…</text>
    </view>

    <!-- 加载失败：可重试，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button class="action" @tap="handleRetry">重试</button>
      <button class="action action--ghost" @tap="handleBackHome">返回首页</button>
    </view>

    <!-- 卷首：作答说明 + 维度概览（文案由服务端下发，改文案零发版） -->
    <view v-else-if="stage === 'intro' && paper" class="intro">
      <view class="intro__title">{{ paper.scaleName }}</view>
      <view v-if="paper.introText" class="intro__text">{{ paper.introText }}</view>

      <view class="card">
        <view class="card__title">本次包含</view>
        <view class="card__row">
          <text class="card__label">题目数量</text>
          <text class="card__value">{{ paper.itemCount }} 题</text>
        </view>
        <view class="card__row">
          <text class="card__label">评估维度</text>
          <text class="card__value">{{ paper.dimensions.filter((item) => item.isScored).length }} 个</text>
        </view>
      </view>

      <view v-if="answeredCount > 0" class="resume">
        上次已完成 {{ answeredCount }} / {{ total }} 题，接着往下答就好
      </view>

      <button class="action" @tap="handleStart">
        {{ answeredCount > 0 ? '继续作答' : '开始作答' }}
      </button>
    </view>

    <!-- 答题态 -->
    <view v-else-if="paper && currentQuestion" class="answering">
      <view class="progress">
        <view class="progress__bar">
          <view class="progress__inner" :style="{ width: `${progressPercent}%` }" />
        </view>
        <text class="progress__text">已完成 {{ answeredCount }} / {{ total }} 题</text>
      </view>

      <view v-if="showBaselineIntro" class="notice">{{ paper.baselineIntroText }}</view>

      <view v-if="syncState === 'pending'" class="notice notice--warn">
        网络不稳定，答案已保存在本机，联网后会自动同步
      </view>

      <QuestionItem
        :question="currentQuestion"
        :value="answers[currentQuestion.code]"
        :order="currentOrder"
        :total="total"
        :sensitive-hint="showSensitiveHint"
        :skipped="isCurrentSkipped"
        @select="handleSelect"
        @skip="handleSkipQuestion"
        @unskip="handleUnskipQuestion"
      />

      <view class="nav">
        <button class="nav__button" :disabled="questionIndex === 0" @tap="handlePrevious">上一题</button>
        <button v-if="!isLastQuestion" class="nav__button" @tap="handleNext">下一题</button>
        <button
          v-else
          class="nav__button nav__button--primary"
          :loading="submitting"
          :disabled="submitting"
          @tap="handleSubmit"
        >
          {{ submitLabel }}
        </button>
      </view>

      <view class="footer">
        <!-- 交卷前中性提示（ADR-013 决策 7）：只陈述事实，不禁用交卷按钮 -->
        <view v-if="skippedSummaryText" class="footer__skip">{{ skippedSummaryText }}</view>
        <view class="footer__row">
          <template v-if="isComplete">
            <button
              v-if="!isLastQuestion"
              class="footer__button"
              :loading="submitting"
              :disabled="submitting"
              @tap="handleSubmit"
            >
              {{ submitLabel }}
            </button>
          </template>
          <template v-else>
            <text class="footer__text">还有 {{ missingCount }} 题未作答</text>
            <text class="footer__link" @tap="handleJumpToMissing">去补答</text>
          </template>
        </view>
      </view>
    </view>

    <!-- 敏感维度前置同意（B7）：隐私约束 2.4 要求单独勾选同意 -->
    <view v-if="consentDimension" class="mask">
      <view class="dialog">
        <view class="dialog__title">关于「{{ consentDimension.name }}」</view>
        <view class="dialog__text">
          这个维度涉及较为私密的话题，需要你单独确认。选择跳过不会影响其他维度的结果，报告会标注「未评估」，你也可以之后再来补答。
        </view>
        <button class="action" @tap="handleConsentAgree">我愿意作答</button>
        <button class="action action--ghost" @tap="handleConsentSkip">暂时跳过这个维度</button>
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

.intro {
  &__title {
    margin-bottom: 24rpx;
    font-size: $zb-font-size-report-title;
    font-weight: 600;
    color: $zb-color-text;
  }

  &__text {
    margin-bottom: 32rpx;
    font-size: $zb-font-size-base;
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

  &__row {
    display: flex;
    justify-content: space-between;
    padding: 10rpx 0;
  }

  &__label {
    font-size: $zb-font-size-base;
    color: $zb-color-text-secondary;
  }

  &__value {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }
}

.resume {
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
  font-size: 26rpx;
  color: $zb-color-primary;
  background-color: rgba(232, 115, 74, 0.08);
  border-radius: $zb-radius-card;
}

.progress {
  margin-bottom: 32rpx;

  &__bar {
    height: 12rpx;
    overflow: hidden;
    background-color: rgba(138, 128, 120, 0.18);
    border-radius: 999rpx;
  }

  &__inner {
    height: 100%;
    background-color: $zb-color-primary;
    border-radius: 999rpx;
    transition: width 0.2s ease;
  }

  &__text {
    display: block;
    margin-top: 12rpx;
    font-size: 24rpx;
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

.nav {
  display: flex;
  gap: 20rpx;
  margin-top: 40rpx;

  &__button {
    flex: 1;
    color: $zb-color-text;
    background-color: $zb-color-surface;

    &--primary {
      color: $zb-color-surface;
      background-color: $zb-color-primary;
    }

    &[disabled] {
      color: $zb-color-text-secondary;
      opacity: 0.6;
    }

    &::after {
      border: none;
    }
  }
}

.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24rpx;

  // 存在跳过题时的中性提示（ADR-013 决策 7）：不抢视觉焦点，也不阻断交卷
  &__skip {
    width: 100%;
    padding: 16rpx 24rpx;
    margin-bottom: 16rpx;
    font-size: 24rpx;
    line-height: 1.6;
    color: $zb-color-text-secondary;
    background-color: $zb-color-surface;
    border-radius: $zb-radius-card;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  &__button {
    width: 100%;
    color: $zb-color-surface;
    background-color: $zb-color-primary;

    &::after {
      border: none;
    }
  }

  &__text {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__link {
    margin-left: 16rpx;
    font-size: 24rpx;
    color: $zb-color-primary;
  }
}

.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background-color: rgba(43, 38, 34, 0.5);
}

.dialog {
  width: 100%;
  padding: 40rpx 32rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 20rpx;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__text {
    margin-bottom: 32rpx;
    font-size: 26rpx;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
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
