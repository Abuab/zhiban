/**
 * 隐私政策版本（唯一来源）
 * 变更时必须同步三处：本文件、服务端 server/src/common/constants/privacy.ts、docs/privacy-policy.md
 * 规格依据：规范增补 v0.3 §3.3 —— 用户同意的版本号需落库（user.privacy_policy_version）
 */
export const PRIVACY_POLICY_VERSION = 'v1.0';

/** 隐私政策全文页路径（弹窗内「查看全文」跳转用） */
export const PRIVACY_POLICY_PATH = '/pages/privacy/privacy';

/** 隐私同意状态的本地存储键（仅存状态，不存任何个人信息） */
export const PRIVACY_CONSENT_STORAGE_KEY = 'zhiban:privacy-consent';

/** 同意状态：agreed 已同意 / refused 已拒绝（不同意仅可浏览首页） */
export type PrivacyConsentStatus = 'agreed' | 'refused' | 'unknown';
