<script setup lang="ts">
/**
 * 登录页（模块 2）
 * 规格依据：
 *   - PRD-005 §3 启动流程：wx.login → 后端换 openid → 查 user
 *   - 宪法 §2.4：启动即征得隐私政策同意；未满 18 周岁不可使用
 *   - 边界总表 A4：未登录游客点击付费内容 → 先引导登录，登录后回到原页面
 *   - 边界总表 A5：登录失败可重试 + 客服入口，不出现死页
 *   - 边界总表 A6：自填昵称走内容安全检测，违规进人工审核池（本页展示审核中提示）
 */
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { ApiError } from '../../utils/request';
import { ApiErrorCode, ClientErrorCode } from '../../constants/error-code';
import { PRIVACY_POLICY_PATH } from '../../constants/privacy';
import { isLoggedIn, userProfile } from '../../stores/user';
import {
  backAfterLogin,
  confirmAge,
  logout,
  performLogin,
  reportPrivacyConsent,
  updateProfile,
} from '../../utils/auth';
import { privacyConsent } from '../../utils/privacy';
import ConsentModal from '../../components/consent-modal/consent-modal.vue';

/** A4：登录成功后的返回目标（由 gotoLogin 透传） */
const redirect = ref('');
/** 是否已同意隐私政策（未同意不允许登录） */
const consented = ref(privacyConsent.isAgreed());

const loading = ref(false);
const errorText = ref('');
const errorTraceId = ref('');

const nicknameDraft = ref('');
const nicknameSaving = ref(false);

/** 失败的操作类型：供「重试」按钮复现同一操作（A5） */
const lastAction = ref<'login' | 'agree' | 'nickname' | 'age'>('login');
/** 年龄确认弹窗：已登录但未确认年龄时弹出（隐私约束 2.4） */
const showAgeModal = ref(false);
/** 用户声明未满 18 周岁 —— 不可使用，展示阻断提示 */
const ageRejected = ref(false);

const profile = computed(() => userProfile.value);

onLoad((options) => {
  const raw = (options as Record<string, string> | undefined)?.redirect;
  redirect.value = raw ? decodeURIComponent(raw) : '';
  if (isLoggedIn.value) {
    nicknameDraft.value = profile.value?.nickname ?? '';
    checkAgeGate();
  }
});

/** 登录态下校验年龄确认，未确认则弹窗（隐私约束 2.4） */
function checkAgeGate(): void {
  showAgeModal.value = profile.value?.ageConfirmed !== true;
}

/** 上报错误文案映射：网络/微信异常均给出可重试的明确提示（A5） */
function describeError(error: unknown): void {
  if (error instanceof ApiError) {
    errorTraceId.value = error.traceId ?? '';
    if (error.code === ClientErrorCode.NETWORK_ERROR) {
      errorText.value = '网络连接失败，请检查网络后重试';
      return;
    }
    if (error.code === ClientErrorCode.WX_LOGIN_FAILED) {
      errorText.value = '未能唤起微信登录，请重试';
      return;
    }
    if (error.code === ApiErrorCode.RATE_LIMITED) {
      errorText.value = '操作过于频繁，请稍后再试';
      return;
    }
    errorText.value = error.message || '登录失败，请重试';
    return;
  }
  errorTraceId.value = '';
  errorText.value = '登录失败，请重试';
}

/** 清空错误块（重试前调用） */
function clearError(): void {
  errorText.value = '';
  errorTraceId.value = '';
}

async function handleLogin(): Promise<void> {
  if (loading.value) return;
  clearError();
  lastAction.value = 'login';

  if (!consented.value) {
    uni.showToast({ title: '请先同意隐私政策', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    await performLogin();
    // 登录成功后把本地同意状态补报服务端（含政策版本号）
    await reportPrivacyConsent();
    nicknameDraft.value = profile.value?.nickname ?? '';
    uni.showToast({ title: '登录成功', icon: 'success' });
    checkAgeGate();
    if (redirect.value) afterLogin();
  } catch (error) {
    describeError(error);
  } finally {
    loading.value = false;
  }
}

async function handleAgree(): Promise<void> {
  clearError();
  lastAction.value = 'agree';
  consented.value = true;
  // 同意后立即尝试登录：失败也不阻塞（用户可点「重试」或「微信一键登录」，A5）
  loading.value = true;
  try {
    await performLogin();
    await reportPrivacyConsent();
    nicknameDraft.value = profile.value?.nickname ?? '';
    checkAgeGate();
    if (redirect.value) afterLogin();
  } catch (error) {
    describeError(error);
  } finally {
    loading.value = false;
  }
}

/** A5：重试上一次失败的操作，不出现死页 */
function handleRetry(): void {
  if (lastAction.value === 'nickname') {
    void handleSaveNickname();
    return;
  }
  if (lastAction.value === 'age') {
    void handleConfirmAge();
    return;
  }
  void (lastAction.value === 'agree' ? handleAgree() : handleLogin());
}

async function handleSaveNickname(): Promise<void> {
  const nickname = nicknameDraft.value.trim();
  if (!nickname) {
    uni.showToast({ title: '昵称不能为空', icon: 'none' });
    return;
  }
  if (nickname === profile.value?.nickname) {
    uni.showToast({ title: '昵称未修改', icon: 'none' });
    return;
  }

  nicknameSaving.value = true;
  clearError();
  lastAction.value = 'nickname';
  try {
    const result = await updateProfile({ nickname });
    if (result.nicknameNotice) {
      // A6：命中内容安全 → 进入审核池（昵称暂不生效，原昵称保持不变）
      uni.showModal({ title: '昵称待审核', content: result.nicknameNotice, showCancel: false });
    } else {
      uni.showToast({ title: '已保存', icon: 'success' });
    }
  } catch (error) {
    describeError(error);
  } finally {
    nicknameSaving.value = false;
  }
}

async function handleConfirmAge(): Promise<void> {
  showAgeModal.value = false;
  lastAction.value = 'age';
  clearError();
  try {
    await confirmAge();
    uni.showToast({ title: '已确认', icon: 'success' });
  } catch (error) {
    describeError(error);
  }
}

function handleRejectAge(): void {
  // 未满 18 周岁不可使用（隐私约束 2.4）：清理登录态并展示阻断提示
  showAgeModal.value = false;
  ageRejected.value = true;
  void logout();
}

async function handleLogout(): Promise<void> {
  await logout();
  nicknameDraft.value = '';
  clearError();
  uni.showToast({ title: '已退出登录', icon: 'none' });
}

function afterLogin(): void {
  backAfterLogin(redirect.value || undefined);
}

function openPolicy(): void {
  uni.navigateTo({ url: PRIVACY_POLICY_PATH });
}

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__title">知伴</view>
      <view class="hero__subtitle">用一次认真的对谈，看清你们的关系准备度</view>
    </view>

    <!-- 年龄阻断：未满 18 周岁不可使用（隐私约束 2.4） -->
    <view v-if="ageRejected" class="card card--warn">
      <view class="card__title">暂时无法使用</view>
      <text class="text">知伴面向婚恋准备场景，仅面向已满 18 周岁的用户。</text>
      <text class="text">感谢你的理解。</text>
    </view>

    <template v-else>
      <!-- 隐私政策未同意：先同意才能登录（隐私约束 2.4） -->
      <view v-if="!consented" class="card">
        <view class="card__title">隐私政策</view>
        <text class="text">
          知伴需要你的微信授权以创建账号，并保存你的测评作答与报告。我们不会收集你的真实姓名、身份证号、通讯录或精确位置。
        </text>
        <text class="link" @tap="openPolicy">查看《隐私政策》全文</text>
        <button class="btn btn--primary" :loading="loading" @tap="handleAgree">同意并继续</button>
      </view>

      <!-- 账号状态 -->
      <view class="card">
        <view class="card__title">账号</view>

        <template v-if="isLoggedIn && profile">
          <view class="row">
            <text class="row__label">昵称</text>
            <text class="row__value">{{ profile.nickname || '未设置' }}</text>
          </view>
          <view class="row">
            <text class="row__label">用户编号</text>
            <text class="row__value">{{ profile.id }}</text>
          </view>
          <view class="row">
            <text class="row__label">注册时间</text>
            <text class="row__value">{{ formatDate(profile.createdAt) }}</text>
          </view>
          <view class="row">
            <text class="row__label">隐私政策</text>
            <text class="row__value">
              {{ profile.privacyAgreed ? `已同意 ${profile.privacyPolicyVersion ?? ''}` : '未同意' }}
            </text>
          </view>
          <view class="row">
            <text class="row__label">年龄确认</text>
            <text class="row__value">{{ profile.ageConfirmed ? '已确认成年' : '未确认' }}</text>
          </view>

          <button class="btn btn--ghost" @tap="afterLogin">返回上一页</button>
          <button class="btn btn--ghost" @tap="handleLogout">退出登录</button>
        </template>

        <template v-else>
          <text class="text">登录后你的测评记录与已购权益会自动跟随微信账号，换手机也不会丢失。</text>
          <button class="btn btn--primary" :loading="loading" @tap="handleLogin">微信一键登录</button>
        </template>
      </view>

      <!-- 昵称设置（A6：违规昵称进审核池，不直接拒绝） -->
      <view v-if="isLoggedIn && profile" class="card">
        <view class="card__title">昵称</view>
        <text class="text">
          昵称会展示在邀请页与纪念卡上。提交后我们会做一次内容合规校验，不合规的昵称会进入人工审核，不会立刻生效。
        </text>
        <input
          v-model="nicknameDraft"
          class="input"
          type="nickname"
          placeholder="请输入 2-20 个字"
          :maxlength="20"
        />
        <text v-if="profile.nicknameStatus === 'pending_review'" class="hint">
          上一个昵称正在审核中，通过后自动生效。
        </text>
        <button class="btn btn--primary" :loading="nicknameSaving" @tap="handleSaveNickname">
          保存昵称
        </button>
      </view>

      <!-- A5：错误提示 + 重试 + 客服入口，任何失败都不出现死页 -->
      <view v-if="errorText" class="card card--error">
        <view class="card__title">操作失败</view>
        <text class="text">{{ errorText }}</text>
        <text v-if="errorTraceId" class="hint">报错编号：{{ errorTraceId }}（提供给客服可快速定位）</text>
        <button class="btn btn--primary" :loading="loading" @tap="handleRetry">重试</button>
        <button class="btn btn--ghost" open-type="contact">联系客服</button>
      </view>
    </template>

    <ConsentModal :visible="showAgeModal" mode="age" @accept="handleConfirmAge" @reject="handleRejectAge" />
  </view>
</template>

<style lang="scss" scoped>
.page {
  padding: 48rpx 32rpx 80rpx;
}

.hero {
  margin-bottom: 40rpx;

  &__title {
    font-size: 48rpx;
    font-weight: 600;
  }

  &__subtitle {
    margin-top: 12rpx;
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
    font-size: 32rpx;
    font-weight: 600;
  }

  &--error {
    border: 1rpx solid $zb-color-danger;
  }

  &--warn {
    border: 1rpx solid $zb-color-warning;
  }
}

.text {
  display: block;
  margin-bottom: 12rpx;
  line-height: 1.7;
}

.link {
  display: block;
  margin-bottom: 24rpx;
  color: $zb-color-primary;
  text-decoration: underline;
}

.hint {
  display: block;
  margin-bottom: 16rpx;
  color: $zb-color-text-secondary;
  font-size: 24rpx;
}

.row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;

  &__label {
    color: $zb-color-text-secondary;
  }

  &__value {
    max-width: 60%;
    text-align: right;
    word-break: break-all;
  }
}

.input {
  padding: 20rpx 24rpx;
  margin: 16rpx 0 24rpx;
  background-color: $zb-color-bg;
  border-radius: 12rpx;
}

.btn {
  margin-top: 16rpx;
  font-size: 30rpx;

  &--primary {
    color: $zb-color-surface;
    background-color: $zb-color-primary;
  }

  &--ghost {
    color: $zb-color-text-secondary;
    background-color: transparent;
    border: 1rpx solid $zb-color-text-secondary;
  }

  &::after {
    border: none;
  }
}
</style>
