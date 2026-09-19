/**
 * 客户端需分支处理的错误码子集
 * 完整错误码定义见服务端 server/src/common/constants/error-code.ts（新增需两端同步）
 */
export const ApiErrorCode = {
  SUCCESS: 0,
  PARAM_INVALID: 10001,
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
  /** 报告未就绪 / 尚未交卷（40005，HTTP 400） */
  REPORT_NOT_READY: 40005,
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
