import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { WechatConfig } from '../../config/configuration.js';
import { RedisService } from '../redis/redis.service.js';
import type {
  AccessTokenResponse,
  Code2SessionResult,
  MsgSecCheckResponse,
  TextCheckResult,
} from './wechat.types.js';

/**
 * 微信接口地址写死为官方域名，不走环境变量：
 * 若可配置，一旦被改为中间人地址即等于登录态与用户 openid 全部泄露
 */
const CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';

/** 单次请求超时（毫秒）：微信抖动时快速失败，由前端重试（A5 不出死页） */
const REQUEST_TIMEOUT_MS = 5000;
/** access_token 提前刷新秒数：避免边界过期导致内容检测整批失败 */
const TOKEN_REFRESH_AHEAD_SECONDS = 300;
/** access_token 缓存键（Redis 由 RedisService 统一加 keyPrefix） */
const ACCESS_TOKEN_CACHE_KEY = 'wx:access_token';
/** msg_sec_check 场景：1 = 资料（昵称/头像） */
const MSG_SEC_CHECK_SCENE_PROFILE = 1;
/** 微信错误码：code 无效 / code 已被使用 —— 前端重新 wx.login 换码后重试即可（A5） */
const INVALID_CODE_ERRS = new Set([40029, 40163]);
/**
 * 微信错误码：服务端配置错误（appid 无效 / appsecret 无效 / 调用 IP 不在白名单）
 * 这类错误重试永远不会成功，必须报运维修复；若混进 INVALID_CODE_ERRS
 * 会对外提示「凭证已失效，请重试」并让用户无限重试，把配置故障藏起来。
 */
const CONFIG_ERRS = new Set([40013, 40125, 40164]);
/** 微信错误码：access_token 失效，需强制刷新后重试一次 */
const INVALID_TOKEN_ERRS = new Set([40001, 40014, 42001]);

/**
 * 微信开放接口网关（模块 2）
 * 职责：code2session 换 openid、msg_sec_check 内容安全检测、access_token 统一缓存
 * 规格依据：
 *   - PRD-005 §3 启动流程「wx.login → 后端换 openid」
 *   - 边界总表 A6「昵称走内容安全接口」
 *   - 安全基线 §4「密钥放环境变量，禁止进代码库」
 * 安全约束：
 *   - session_key 只在内存中流转，禁止落库/落日志（可解密用户敏感数据）
 *   - openid 属个人信息，日志中禁止输出明文
 */
@Injectable()
export class WechatService implements OnModuleInit {
  private accessTokenRefreshing: Promise<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    if (this.configured) return;
    const hint = '微信小程序凭证未配置（WX_APPID / WX_SECRET），登录与内容安全接口不可用';
    if (this.isProduction) {
      // 生产缺凭证属阻断级配置缺失，但不直接崩溃：避免整个服务（含健康检查）不可用
      this.logger.error(`${hint}；上线前必须配置`, undefined, 'WechatService');
    } else {
      this.logger.warn(`${hint}；本地开发可开启 WX_MOCK_LOGIN=true 走模拟登录`, 'WechatService');
    }
  }

  /**
   * code2session：小程序 wx.login 的 code 换 openid
   * A5 失败处理：微信侧区分「凭证失效（可重试换码）」与「微信服务异常（可稍后重试）」
   */
  async code2Session(code: string): Promise<Code2SessionResult> {
    if (this.mockEnabled) {
      return this.mockCode2Session(code);
    }
    this.assertConfigured();

    if (!code) {
      throw new BusinessException(ErrorCode.WX_CODE_INVALID);
    }

    const wechat = this.wechatConfig;
    const query = new URLSearchParams({
      appid: wechat.appid,
      secret: wechat.secret,
      js_code: code,
      grant_type: 'authorization_code',
    });

    let payload: Partial<Code2SessionResult> & { errcode?: number; errmsg?: string };
    try {
      payload = await this.fetchJson<Partial<Code2SessionResult> & { errcode?: number; errmsg?: string }>(
        `${CODE2SESSION_URL}?${query.toString()}`,
      );
    } catch (error) {
      // 网络层失败：不区分具体原因对外，统一提示可重试（A5）
      this.logger.error(
        `code2session 请求失败：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'WechatService',
      );
      throw new BusinessException(ErrorCode.WX_API_ERROR);
    }

    if (payload.errcode) {
      const detail = `errcode=${payload.errcode} errmsg=${payload.errmsg ?? ''}`;
      if (INVALID_CODE_ERRS.has(payload.errcode)) {
        this.logger.warn(`code2session 凭证无效：${detail}`, 'WechatService');
        throw new BusinessException(ErrorCode.WX_CODE_INVALID);
      }
      if (CONFIG_ERRS.has(payload.errcode)) {
        // 对外不暴露配置细节，但服务端必须留下可运维定位的错误日志
        this.logger.error(`code2session 配置错误（需运维修复）：${detail}`, undefined, 'WechatService');
        throw new BusinessException(ErrorCode.WX_API_ERROR);
      }
      this.logger.error(`code2session 失败：${detail}`, undefined, 'WechatService');
      throw new BusinessException(ErrorCode.WX_API_ERROR);
    }

    if (!payload.openid || !payload.session_key) {
      this.logger.error('code2session 返回缺少 openid/session_key', undefined, 'WechatService');
      throw new BusinessException(ErrorCode.WX_API_ERROR);
    }

    return {
      openid: payload.openid,
      session_key: payload.session_key,
      unionid: payload.unionid,
    };
  }

  /**
   * 内容安全检测（wxa/msg_sec_check，version=2）
   * 失败降级：微信接口不可用时返回 source='unavailable'，由调用方按「本地词表兜底 + 放行」处理，
   *          不因第三方故障阻断用户改昵称（可用性优先，与限流守卫的降级策略一致）
   */
  async checkText(content: string, openid: string): Promise<TextCheckResult> {
    if (!this.configured) {
      return { source: 'unavailable', reason: 'wechat_credentials_missing' };
    }
    if (this.mockEnabled) {
      // 模拟登录下微信内容安全不可用：走本地词表兜底，便于本地/联调环境验证 A6 链路
      return { source: 'unavailable', reason: 'wx_mock_login' };
    }

    try {
      const result = await this.requestMsgSecCheck(content, openid, true);
      return result;
    } catch (error) {
      this.logger.warn(
        `内容安全检测不可用，降级为本地词表兜底：${error instanceof Error ? error.message : String(error)}`,
        'WechatService',
      );
      return { source: 'unavailable', reason: 'wx_api_error' };
    }
  }

  /** 带一次 access_token 失效重试的检测调用 */
  private async requestMsgSecCheck(
    content: string,
    openid: string,
    allowTokenRetry: boolean,
  ): Promise<TextCheckResult> {
    const token = await this.getAccessToken();
    const payload = await this.fetchJson<MsgSecCheckResponse>(
      `${MSG_SEC_CHECK_URL}?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 2,
          openid,
          scene: MSG_SEC_CHECK_SCENE_PROFILE,
          content,
        }),
      },
    );

    if (payload.errcode) {
      if (allowTokenRetry && INVALID_TOKEN_ERRS.has(payload.errcode)) {
        // access_token 可能已被其他实例刷新覆盖，删缓存后重试一次
        await this.redis.del(ACCESS_TOKEN_CACHE_KEY);
        return this.requestMsgSecCheck(content, openid, false);
      }
      throw new Error(`msg_sec_check errcode=${payload.errcode} errmsg=${payload.errmsg ?? ''}`);
    }

    const suggest = payload.result?.suggest ?? 'pass';
    return {
      source: 'wx',
      passed: suggest === 'pass',
      label: payload.result?.label,
      raw: payload,
    };
  }

  /** access_token 统一缓存（Redis），提前 5 分钟刷新；并发时用单飞避免击穿 */
  private async getAccessToken(): Promise<string> {
    const cached = await this.redis.get(ACCESS_TOKEN_CACHE_KEY);
    if (cached) return cached;
    if (this.accessTokenRefreshing) return this.accessTokenRefreshing;

    this.accessTokenRefreshing = this.refreshAccessToken().finally(() => {
      this.accessTokenRefreshing = null;
    });
    return this.accessTokenRefreshing;
  }

  private async refreshAccessToken(): Promise<string> {
    this.assertConfigured();
    const wechat = this.wechatConfig;
    const query = new URLSearchParams({
      grant_type: 'client_credential',
      appid: wechat.appid,
      secret: wechat.secret,
    });

    const payload = await this.fetchJson<AccessTokenResponse>(`${ACCESS_TOKEN_URL}?${query.toString()}`);
    if (!payload.access_token || payload.errcode) {
      throw new Error(
        `获取 access_token 失败：errcode=${payload.errcode ?? '-'} errmsg=${payload.errmsg ?? '-'}`,
      );
    }

    const ttl = Math.max(
      60,
      (payload.expires_in ?? 7200) - TOKEN_REFRESH_AHEAD_SECONDS,
    );
    await this.redis.set(ACCESS_TOKEN_CACHE_KEY, payload.access_token, ttl);
    return payload.access_token;
  }

  /**
   * 模拟登录（仅非生产可用，由 WX_MOCK_LOGIN 开启）
   * 用途：未拿到小程序凭证前，打通「登录 → 会话 → 受保护接口」全链路自测
   * 原理：同一 code 稳定映射到同一 openid（哈希），从而可验证建档幂等
   */
  private mockCode2Session(code: string): Code2SessionResult {
    const openid = `mock_${createHash('sha256').update(code).digest('hex').slice(0, 28)}`;
    return { openid, session_key: 'mock_session_key' };
  }

  /** 带超时的 JSON 请求（Node 18+ 内置 fetch） */
  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertConfigured(): void {
    if (this.configured) return;
    this.logger.error('微信凭证未配置，无法调用微信接口', undefined, 'WechatService');
    throw new BusinessException(ErrorCode.WX_API_ERROR);
  }

  private get wechatConfig(): WechatConfig {
    return this.config.get<WechatConfig>('wechat') as WechatConfig;
  }

  private get configured(): boolean {
    const wechat = this.wechatConfig;
    return Boolean(wechat?.appid && wechat?.secret);
  }

  private get isProduction(): boolean {
    return this.config.get<boolean>('app.isProduction') === true;
  }

  /**
   * 模拟登录开关：生产环境强制关闭
   * 原因：模拟登录可用任意 code 伪造账号，生产开启等于开放「任意登录」后门
   */
  private get mockEnabled(): boolean {
    if (this.isProduction) return false;
    return this.config.get<boolean>('wechat.mockEnabled') === true;
  }
}
