/**
 * 客户端需分支处理的错误码子集
 * 完整错误码定义见服务端 server/src/common/constants/error-code.ts（新增需两端同步）
 */
export const ApiErrorCode = {
  SUCCESS: 0,
  PARAM_INVALID: 10001,
  /**
   * 资源不存在，或存在但不属于本人
   * 两者合并返回同一码是**有意为之**（ADR-005 决策 1）：区分会形成「按自增 id 探测资源是否存在」的枚举 oracle
   */
  RESOURCE_NOT_FOUND: 10002,
  /** 未登录 */
  UNAUTHORIZED: 20001,
  /** 登录已过期 */
  TOKEN_EXPIRED: 20002,
  /** 需确认已满 18 周岁（隐私约束 2.4） */
  AGE_NOT_CONFIRMED: 20003,
  /** 未同意隐私政策（隐私约束 2.4） */
  PRIVACY_NOT_AGREED: 20004,
  /** 微信 code 失效，可重试换码（A5） */
  WX_CODE_INVALID: 20005,
  /** 微信服务不可用，可稍后重试（A5） */
  WX_API_ERROR: 20006,
  /** 昵称不合法 */
  NICKNAME_INVALID: 20007,
  /** 账号被停用 */
  ACCOUNT_DISABLED: 20008,
  /** 会话已失效（已退出登录 / 被撤销） */
  SESSION_INVALID: 20009,
  /** 还有题目未作答（交卷被拒，附未答题数） */
  ANSWER_INCOMPLETE: 30002,
  /** 已交卷，答案不可修改（B5 答案锁定） */
  ANSWER_LOCKED: 30003,
  /** 答案已在其他设备更新，需刷新后重试（A3 多端乐观锁，HTTP 409） */
  ANSWER_DRAFT_CONFLICT: 30004,
  /** 邀请不存在（邀请码格式不符 / 已取消走同一码，HTTP 404） */
  INVITE_NOT_FOUND: 40001,
  /** 该邀请已被接受（C1：邀请码只绑定首个打开者），提示后返回 */
  INVITE_ALREADY_ACCEPTED: 40002,
  /** 邀请已过期（C4）：发起方可在原页续期 7 天 */
  INVITE_EXPIRED: 40003,
  /** 当前状态不允许该操作（重复同意 / 非被邀请方作答 / 提醒·续期·换人次数已用完） */
  INVITE_STATUS_INVALID: 40004,
  /** 报告未就绪 / 尚未交卷（40005，HTTP 400） */
  REPORT_NOT_READY: 40005,
  /** 未完成同版本单人测评，无法发起邀请（ADR-005 决策 7）→ 跳单人测评页 */
  INVITE_PREREQUISITE_MISSING: 40007,
  /** 已有进行中的邀请（同时最多 1 个）→ 跳转到该邀请 */
  INVITE_ALREADY_ACTIVE: 40008,
  /** 触发限流 */
  RATE_LIMITED: 70001,
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * 客户端本地错误码（非服务端返回）
 * 取值落在负数列，避免与服务端错误码（正数）混淆
 */
export const ClientErrorCode = {
  /** 网络连接失败（见 utils/request.ts 的 NETWORK_ERROR_CODE，保持同值） */
  NETWORK_ERROR: -1,
  /** wx.login 未取到 code（用户取消授权 / 微信异常），可重试（A5） */
  WX_LOGIN_FAILED: -1001,
} as const;
