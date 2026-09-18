import { ClientErrorCode } from '../constants/error-code';
import { PRIVACY_POLICY_VERSION } from '../constants/privacy';
import { authApi } from '../api/auth';
import type { LoginResult } from '../types/api';
import { clearLoginState, setLoginState, setUserProfile, userProfile } from '../stores/user';
import { privacyConsent } from './privacy';
import { ApiError, setUnauthorizedHandler } from './request';
import { authToken } from './token';

/**
 * 登录编排（模块 2）
 * 规格依据：
 *   - PRD-005 §3 启动流程：wx.login → 后端换 openid → 查 user
 *   - 边界总表 A1：换手机/重装后 token 失效 → 静默重新登录，用户无感
 *   - 边界总表 A4：未登录点付费内容 → 先引导登录，登录后回到原页面
 *   - 边界总表 A5：登录失败可重试，不出现死页
 */

/** 未同意隐私政策时不发起登录（合规：登录前必须先同意隐私政策） */
export function canLogin(): boolean {
  return privacyConsent.isAgreed();
}

/** 调起 wx.login 取 code（失败返回空串，由调用方提示重试） */
function requestLoginCode(): Promise<string> {
  return new Promise((resolve) => {
    uni.login({
      provider: 'weixin',
      success: (res) => resolve(res.code ?? ''),
      fail: () => resolve(''),
    });
  });
}

/**
 * 主动登录：失败时向上抛错，由登录页展示文案并提供重试（A5 不做死页）
 * 注意：调用前必须已同意隐私政策（隐私约束 2.4）
 */
export async function performLogin(): Promise<LoginResult> {
  const code = await requestLoginCode();
  if (!code) {
    // wx.login 本身失败（用户取消授权 / 微信异常）—— 抛出可重试错误（A5）
    throw new ApiError(ClientErrorCode.WX_LOGIN_FAILED, '未获取到微信登录凭证，请重试');
  }

  const result = await authApi.login(code);
  authToken.set(result.token);
  setLoginState(result.user);
  return result;
}

/**
 * 静默登录：不弹任何界面，登录成功即写入登录态
 * 用于 A1（启动/失效后自动重登）与 A4 的前置尝试
 */
export async function silentLogin(): Promise<boolean> {
  if (!canLogin()) return false;

  try {
    await performLogin();
    return true;
  } catch {
    // 静默登录失败不打扰用户：由 ensureLogin 决定是否进入登录页（A5 不做死页）
    return false;
  }
}

/**
 * 启动引导：有 token 则续期，无 token（或续期失败）则静默登录
 * 目的：让「换手机/重装微信/长期未打开」的用户回到小程序时直接是登录态（A1 用户无感）
 */
export async function bootstrapAuth(): Promise<void> {
  if (!canLogin()) return;

  if (!authToken.get()) {
    await silentLogin();
    return;
  }

  try {
    const result = await authApi.refresh();
    authToken.set(result.token);
    setLoginState(result.user);
  } catch {
    authToken.clear();
    clearLoginState();
    await silentLogin();
  }
}

/** 跳转登录页，并把当前页面（含查询参数）作为登录成功后的返回目标（A4） */
export function gotoLogin(): void {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1] as
    | { route?: string; options?: Record<string, string> }
    | undefined;

  const route = current?.route ? `/${current.route}` : '';
  const query = current?.options
    ? Object.keys(current.options)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(current.options?.[key] ?? '')}`)
        .join('&')
    : '';
  const redirect = route ? (query ? `${route}?${query}` : route) : '';

  const url = redirect
    ? `/pages/login/login?redirect=${encodeURIComponent(redirect)}`
    : '/pages/login/login';
  uni.navigateTo({ url });
}

/**
 * 登录成功后回到来源页面（A4）
 * 只接受小程序内部路径，且目标不是登录页自身，防止被外部参数带到任意页面
 */
export function backAfterLogin(redirect?: string): void {
  const target = redirect?.trim() ?? '';
  if (target.startsWith('/pages/') && !target.startsWith('/pages/login/login')) {
    uni.redirectTo({
      url: target,
      fail: () => {
        uni.navigateBack({ delta: 1 });
      },
    });
    return;
  }

  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  uni.reLaunch({ url: '/pages/index/index' });
}

/**
 * 需要登录的操作统一入口（A4）
 * 返回 true 表示当前已具备登录态，调用方可继续原操作；
 * 返回 false 表示已跳转登录页（或未同意隐私政策），调用方应中止本次操作
 */
export async function ensureLogin(): Promise<boolean> {
  if (!canLogin()) {
    uni.showToast({ title: '请先同意隐私政策', icon: 'none' });
    return false;
  }
  if (authToken.get()) return true;

  const ok = await silentLogin();
  if (ok) return true;

  gotoLogin();
  return false;
}

/** 退出登录：撤销当前设备会话并清理本地登录态（其他设备不受影响 A3） */
export async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch (error) {
    // 服务端会话可能已过期：仍要清理本地，避免用户卡在「退不出去」的状态
    if (!(error instanceof ApiError)) throw error;
  } finally {
    authToken.clear();
    clearLoginState();
  }
}

/** 更新资料并刷新内存中的用户资料 */
export async function updateProfile(
  payload: Parameters<typeof authApi.updateProfile>[0],
): Promise<{ nicknameNotice?: string }> {
  const result = await authApi.updateProfile(payload);
  setLoginState(result.profile);
  return { nicknameNotice: result.nicknameNotice };
}

/**
 * 把本地「已同意隐私政策」补报到服务端（幂等：服务端已记录同版本则跳过）
 * 规格依据：规范增补 v0.3 §3.3（同意的版本号需落库）
 * 场景：先点「同意并继续」（此时还没登录）→ 随后登录成功 → 补报
 */
export async function reportPrivacyConsent(): Promise<void> {
  if (!authToken.get()) return;
  if (!privacyConsent.isAgreed()) return;
  if (userProfile.value?.privacyAgreed && userProfile.value.privacyPolicyVersion === PRIVACY_POLICY_VERSION) {
    return;
  }
  try {
    const result = await authApi.updateProfile({
      privacyAgreed: true,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    });
    setUserProfile(result.profile);
  } catch {
    // 上报失败不影响继续使用：本地已记录同意，下次启动会重新上报
  }
}

/** 同意隐私政策：本地记录 → 尝试静默登录 → 登录后补报服务端 */
export async function acceptPrivacyPolicy(): Promise<void> {
  privacyConsent.agree();
  if (!authToken.get()) {
    await silentLogin();
  }
  await reportPrivacyConsent();
}

/** 拒绝隐私政策：仅可浏览首页（隐私约束 2.4） */
export function refusePrivacyPolicy(): void {
  privacyConsent.refuse();
  authToken.clear();
  clearLoginState();
}

/** 是否已确认年满 18 周岁（未确认不可使用，隐私约束 2.4） */
export function hasAgeConfirmed(): boolean {
  return userProfile.value?.ageConfirmed === true;
}

/** 确认已满 18 周岁并上报服务端 */
export async function confirmAge(): Promise<void> {
  const result = await authApi.updateProfile({ ageConfirmed: true });
  setLoginState(result.profile);
}

/**
 * 注册 401 静默重登处理器（在 App 启动时调用一次）
 * 效果：任何受保护接口遇到 401 → 自动静默重登 → 重放原请求，用户无感知（A1）
 */
export function registerUnauthorizedHandler(): void {
  setUnauthorizedHandler(async () => {
    clearLoginState();
    return silentLogin();
  });
}
