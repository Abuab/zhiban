/** 微信开放接口返回结构（仅声明本项目用到的字段） */

/** sns/jscode2session 成功响应 */
export interface Code2SessionResult {
  openid: string;
  session_key: string;
  unionid?: string;
}

/** sns/jscode2session 失败响应 */
export interface WechatErrorResponse {
  errcode: number;
  errmsg: string;
}

/** cgi-bin/token 响应 */
export interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

/** wxa/msg_sec_check 响应（version=2） */
export interface MsgSecCheckResponse {
  errcode: number;
  errmsg: string;
  result?: {
    /** pass 通过 / review 需人工复核 / risky 违规 */
    suggest: 'pass' | 'review' | 'risky';
    /** 微信违规标签编号 */
    label?: number;
  };
  trace_id?: string;
}

/**
 * 内容安全检测结果（本项目内部结构，屏蔽微信细节）
 * 判别联合：调用方必须先按 source 分支，禁止只看 passed 字段——
 * 这可以避免把「检测不可用」误当成「检测通过」或「检测违规」
 */
export type TextCheckResult =
  | {
      /** 微信内容安全接口已给出判定 */
      source: 'wx';
      /** true = 可放行；false = 需入人工审核池（不直接拒绝，见 A6） */
      passed: boolean;
      /** 命中的微信标签编号 */
      label?: number;
      /** 微信原始返回，落审核池备查 */
      raw?: unknown;
    }
  | {
      /** 微信接口不可用（未配置凭证 / 超时 / 报错），降级由本地敏感词兜底 */
      source: 'unavailable';
      /** 不可用原因（仅记日志，不外发） */
      reason: string;
    };

/** cgi-bin/message/subscribe/send 响应（errcode=0 才算送达） */
export interface SubscribeSendResponse {
  errcode: number;
  errmsg: string;
}

/** 订阅消息投递入参（data 的键为模板字段名，值为 {value} 结构，由微信侧模板定义决定） */
export interface SubscribeMessageInput {
  /** 接收者 openid（订阅消息不落日志明文） */
  openid: string;
  /** 模板 ID（运营在微信公众平台创建，走环境变量配置） */
  templateId: string;
  /** 点击消息后跳转的小程序页面；为空则跳到首页 */
  page?: string;
  /** 模板数据：字段名 → { value } */
  data: Record<string, { value: string }>;
}

/**
 * 订阅消息投递结果
 * 用判别联合而非抛异常：调用方必须区分「送达」与「未送达」才能决定是否消耗用户提醒额度
 * （ADR-005 决策 6：未送达不计数），异常控制流容易在 catch 里被吞掉而误扣额度。
 */
export type SubscribeSendResult =
  | { delivered: true; mocked?: boolean }
  | { delivered: false; reason: string };
