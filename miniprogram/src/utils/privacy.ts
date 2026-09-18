import {
  PRIVACY_CONSENT_STORAGE_KEY,
  PRIVACY_POLICY_VERSION,
  type PrivacyConsentStatus,
} from '../constants/privacy';

/**
 * 隐私政策同意状态（本地）
 * 规格依据：宪法 §2.4「启动即弹《隐私政策》，不同意则仅可浏览首页」
 * 说明：
 *   1. 本地只存同意状态与所同意的版本号，不存任何个人信息（P3 隐私即卖点）
 *   2. 记录版本号的目的：政策升版后需重新征得同意（规范增补 v0.3 §3.3）
 *   3. 同意动作同时上报服务端（落库 user.privacy_policy_version），用于留痕
 */
interface ConsentRecord {
  status: 'agreed' | 'refused';
  version: string;
}

function read(): ConsentRecord | null {
  const raw = uni.getStorageSync(PRIVACY_CONSENT_STORAGE_KEY) as string | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw as string) as ConsentRecord;
    if (parsed?.status === 'agreed' || parsed?.status === 'refused') return parsed;
    return null;
  } catch {
    // 历史遗留的非 JSON 值（或本地存储被篡改）一律视为未表态，重新征得同意
    return null;
  }
}

function write(status: ConsentRecord['status']): void {
  uni.setStorageSync(
    PRIVACY_CONSENT_STORAGE_KEY,
    JSON.stringify({ status, version: PRIVACY_POLICY_VERSION } satisfies ConsentRecord),
  );
}

export const privacyConsent = {
  status(): PrivacyConsentStatus {
    return read()?.status ?? 'unknown';
  },

  /** 用户已同意的政策版本（未同意或已拒绝时为 null） */
  agreedVersion(): string | null {
    const record = read();
    return record?.status === 'agreed' ? record.version : null;
  },

  agree(): void {
    write('agreed');
  },

  refuse(): void {
    write('refused');
  },

  /** 是否已同意「当前版本」的政策（政策升版后自动失效，需重新同意） */
  isAgreed(): boolean {
    return this.agreedVersion() === PRIVACY_POLICY_VERSION;
  },

  /** 是否需要弹出同意弹窗（未表态 / 曾拒绝 / 政策已升版） */
  needsConsent(): boolean {
    return !this.isAgreed();
  },
};
