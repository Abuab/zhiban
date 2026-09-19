/**
 * 统一错误码（接口契约）
 * 约定：0 = 成功；1xxxx = 通用错误；2xxxx = 账号；3xxxx = 量表/测评；4xxxx = 邀请/报告；
 *       5xxxx = 内容/锦囊；6xxxx = 支付权益（P2 预留）；7xxxx = 限流与安全
 */
export enum ErrorCode {
  SUCCESS = 0,

  // 通用
  INTERNAL_ERROR = 10000,
  PARAM_INVALID = 10001,
  RESOURCE_NOT_FOUND = 10002,
  METHOD_NOT_ALLOWED = 10003,
  FORBIDDEN = 10004,

  // 账号与登录（边界总表 A 域）
  UNAUTHORIZED = 20001,
  TOKEN_EXPIRED = 20002,
  AGE_NOT_CONFIRMED = 20003,
  PRIVACY_NOT_AGREED = 20004,
  /** 微信 code 无效或已被使用（A5） */
  WX_CODE_INVALID = 20005,
  /** 微信接口不可用/超时（A5：前端可重试） */
  WX_API_ERROR = 20006,
  /** 昵称格式不合法（长度/字符集） */
  NICKNAME_INVALID = 20007,
  /** 账号已被封禁（A2/F 域） */
  ACCOUNT_DISABLED = 20008,
  /** 会话已被登出或不存在（多设备独立会话 A3） */
  SESSION_INVALID = 20009,
  /** 后台：账号或密码错误（ADR-003，统一文案防账号枚举） */
  ADMIN_CREDENTIAL_INVALID = 20010,
  /** 后台：必须先完成二次验证（TOTP）绑定才能使用后台功能 */
  ADMIN_TOTP_REQUIRED = 20011,
  /** 后台：二次验证码错误 */
  ADMIN_TOTP_INVALID = 20012,
  /** 后台：尚未生成二次验证密钥就先提交了校验码 */
  ADMIN_TOTP_NOT_SETUP = 20013,
  /** 后台：二次验证已绑定，重复绑定需先由运维重置 */
  ADMIN_TOTP_ALREADY_ENABLED = 20014,

  // 量表与测评（A 域之外的 B 域）
  SCALE_NOT_FOUND = 30001,
  ANSWER_INCOMPLETE = 30002,
  ANSWER_LOCKED = 30003,
  /** 草稿版本号冲突：同一微信的另一台设备已写入更新，本次写入被拒（A3 乐观锁） */
  ANSWER_DRAFT_CONFLICT = 30004,

  // 邀请与报告（C / D 域）
  INVITE_NOT_FOUND = 40001,
  INVITE_ALREADY_ACCEPTED = 40002,
  INVITE_EXPIRED = 40003,
  INVITE_STATUS_INVALID = 40004,
  REPORT_NOT_READY = 40005,
  REPORT_FORBIDDEN = 40006,

  // 内容与锦囊（G 域）
  TOPIC_NOT_FOUND = 50001,
  TOPIC_OFFLINE = 50002,
  EXCLUSIVE_CARD_REJECTED = 50003,

  // 支付与权益（P2 预留）
  ORDER_NOT_FOUND = 60001,
  ENTITLEMENT_REQUIRED = 60002,

  // 限流与安全（F 域）
  RATE_LIMITED = 70001,
  IP_FORBIDDEN = 70002,
}

export const ErrorMessage: Record<ErrorCode, string> = {
  [ErrorCode.SUCCESS]: 'ok',
  [ErrorCode.INTERNAL_ERROR]: '服务开小差了，请稍后重试',
  [ErrorCode.PARAM_INVALID]: '参数不合法',
  [ErrorCode.RESOURCE_NOT_FOUND]: '资源不存在',
  [ErrorCode.METHOD_NOT_ALLOWED]: '请求方式不支持',
  [ErrorCode.FORBIDDEN]: '无权访问该资源',
  [ErrorCode.UNAUTHORIZED]: '请先登录',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [ErrorCode.AGE_NOT_CONFIRMED]: '需确认已满 18 周岁后使用',
  [ErrorCode.PRIVACY_NOT_AGREED]: '请先同意隐私政策',
  [ErrorCode.WX_CODE_INVALID]: '微信登录凭证已失效，请重试',
  [ErrorCode.WX_API_ERROR]: '微信服务暂时不可用，请稍后重试',
  [ErrorCode.NICKNAME_INVALID]: '昵称不合法，请换一个',
  [ErrorCode.ACCOUNT_DISABLED]: '账号已被停用，如有疑问请联系客服',
  [ErrorCode.SESSION_INVALID]: '登录状态已失效，请重新登录',
  [ErrorCode.ADMIN_CREDENTIAL_INVALID]: '账号或密码错误',
  [ErrorCode.ADMIN_TOTP_REQUIRED]: '请先完成二次验证绑定',
  [ErrorCode.ADMIN_TOTP_INVALID]: '二次验证码错误或已过期',
  [ErrorCode.ADMIN_TOTP_NOT_SETUP]: '请先获取二次验证密钥',
  [ErrorCode.ADMIN_TOTP_ALREADY_ENABLED]: '二次验证已绑定，如需重置请联系运维',
  [ErrorCode.SCALE_NOT_FOUND]: '量表不存在',
  [ErrorCode.ANSWER_INCOMPLETE]: '还有题目未作答',
  [ErrorCode.ANSWER_LOCKED]: '已交卷，答案不可修改',
  [ErrorCode.ANSWER_DRAFT_CONFLICT]: '答案已在其他设备更新，请刷新后重试',
  [ErrorCode.INVITE_NOT_FOUND]: '邀请不存在或已失效',
  [ErrorCode.INVITE_ALREADY_ACCEPTED]: '该邀请已被接受',
  [ErrorCode.INVITE_EXPIRED]: '邀请已过期',
  [ErrorCode.INVITE_STATUS_INVALID]: '当前状态不支持该操作',
  [ErrorCode.REPORT_NOT_READY]: '报告生成中，完成后通知你',
  [ErrorCode.REPORT_FORBIDDEN]: '无权查看该报告',
  [ErrorCode.TOPIC_NOT_FOUND]: '内容不存在',
  [ErrorCode.TOPIC_OFFLINE]: '内容已下架',
  [ErrorCode.EXCLUSIVE_CARD_REJECTED]: '专属建议生成失败，已为你展示通用版本',
  [ErrorCode.ORDER_NOT_FOUND]: '订单不存在',
  [ErrorCode.ENTITLEMENT_REQUIRED]: '暂未开放该功能',
  [ErrorCode.RATE_LIMITED]: '操作过于频繁，请稍后再试',
  [ErrorCode.IP_FORBIDDEN]: '当前网络环境不可访问',
};
