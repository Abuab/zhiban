import { DRAFT_STORAGE_KEY_PREFIX } from '../constants/assessment';
import type { AnswerSheetStatus } from '../types/assessment';

/**
 * 答题草稿的本地缓存（B2：弱网/提交失败时答案不丢，联网自动补传）
 *
 * 设计要点：
 *   1. 只缓存**答案与草稿版本号**，不缓存任何身份信息（P3 隐私即卖点）；
 *   2. `baseVersion` 记录本地答案所基于的服务端 draftVersion —— 补传时回传该值，
 *      若不等于服务端当前版本说明另一端已改过，服务端返回 30004（A3 乐观锁）→ 前端重新拉取；
 *   3. 服务端对答案落库是逐题（> 0）净化，被跳过的维度题号也会在服务端被剔除，
 *      因此本地补传的内容与服务端口径一致。
 */
export interface LocalDraft {
  sheetId: number;
  /** 本地答案所基于的服务端 draftVersion */
  baseVersion: number;
  answers: Record<string, number | string>;
  skippedDimensions: string[];
  /** 是否有尚未同步到服务端的本地改动 */
  pendingSync: boolean;
  /** 本地最后写入时间（毫秒），用于展示与排查 */
  updatedAt: number;
}

/** 交卷后的答题卷缓存（仅用于「已交卷 → 直接看报告」，不再补传答案） */
export interface SubmittedRecord {
  sheetId: number;
  status: Extract<AnswerSheetStatus, 'submitted'>;
  submittedAt: number;
}

interface StoredPayload {
  draft?: LocalDraft;
  submitted?: SubmittedRecord;
}

function storageKey(sheetId: number): string {
  return `${DRAFT_STORAGE_KEY_PREFIX}${sheetId}`;
}

function readPayload(sheetId: number): StoredPayload | null {
  const raw = uni.getStorageSync(storageKey(sheetId)) as string | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw as string) as StoredPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // 本地存储损坏或被篡改 → 一律视为无缓存，回退到服务端数据
    return null;
  }
}

function writePayload(sheetId: number, payload: StoredPayload): void {
  uni.setStorageSync(storageKey(sheetId), JSON.stringify(payload));
}

export const assessmentDraft = {
  /** 读取本地草稿；无缓存返回 null */
  load(sheetId: number): LocalDraft | null {
    const payload = readPayload(sheetId);
    const draft = payload?.draft;
    if (!draft || typeof draft.sheetId !== 'number') return null;
    return {
      ...draft,
      answers: draft.answers ?? {},
      skippedDimensions: draft.skippedDimensions ?? [],
    };
  },

  /**
   * 写入本地草稿
   * @param pendingSync 是否有未同步到服务端的改动（保存失败时为 true）
   */
  save(input: {
    sheetId: number;
    baseVersion: number;
    answers: Record<string, number | string>;
    skippedDimensions: string[];
    pendingSync: boolean;
  }): void {
    const existing = readPayload(input.sheetId) ?? {};
    writePayload(input.sheetId, {
      ...existing,
      draft: {
        sheetId: input.sheetId,
        baseVersion: input.baseVersion,
        answers: input.answers,
        skippedDimensions: input.skippedDimensions,
        pendingSync: input.pendingSync,
        updatedAt: Date.now(),
      },
    });
  },

  /** 标记「本地改动已全部同步到服务端」 */
  markSynced(sheetId: number, baseVersion: number): void {
    const draft = this.load(sheetId);
    if (!draft) return;
    this.save({ ...draft, baseVersion, pendingSync: false });
  },

  /** 记录已交卷（此后不再补传答案，B5 答案锁定） */
  markSubmitted(sheetId: number): void {
    writePayload(sheetId, {
      submitted: { sheetId, status: 'submitted', submittedAt: Date.now() },
    });
  },

  isSubmitted(sheetId: number): boolean {
    return readPayload(sheetId)?.submitted?.status === 'submitted';
  },

  /** 清除本地缓存（交卷成功后调用，避免无用数据长期驻留本地） */
  clear(sheetId: number): void {
    uni.removeStorageSync(storageKey(sheetId));
  },
};
