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

  // 量表与测评（A 域之外的 B 域）
  SCALE_NOT_FOUND = 30001,
  ANSWER_INCOMPLETE = 30002,
  ANSWER_LOCKED = 30003,

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
  [ErrorCode.SCALE_NOT_FOUND]: '量表不存在',
  [ErrorCode.ANSWER_INCOMPLETE]: '还有题目未作答',
  [ErrorCode.ANSWER_LOCKED]: '已交卷，答案不可修改',
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
