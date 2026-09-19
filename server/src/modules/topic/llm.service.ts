import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { LlmConfig } from '../../config/configuration.js';

/** 单次调用超时（毫秒）：专属卡是用户点击后同步等待的请求，不能让用户干等 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * 温度：专属建议属「有明确输出结构」的创作，取低值让同一输入尽量稳定
 * （仍非确定性，故结果必须落库缓存，见 ADR-007 决策 2）
 */
const TEMPERATURE = 0.6;

/** OpenAI 兼容的对话消息 */
export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmCompletion {
  content: string;
  /** 实际使用的模型名（落 `exclusive_card.model` 便于回溯是哪一次模型输出） */
  model: string;
}

/** 模型未配置（LLM_API_KEY 为空）时抛出，调用方据此走「未配置降级」而不是「模型故障降级」 */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super('LLM_API_KEY 未配置');
    this.name = 'LlmNotConfiguredError';
  }
}

/**
 * 大模型调用服务（模块 7，ADR-007 决策 3 / ADR-008 附带决策 7）
 *
 * 设计约束：
 *   1. 直连 OpenAI 兼容的 `POST {LLM_API_BASE}/chat/completions`，**不引厂商 SDK**
 *      —— 换供应商只改 `.env`，不产生依赖升级与供应链风险。
 *   2. 失败**一律抛错**，由调用方决定降级策略（本服务不吞异常、不返回空串）：
 *      「调用失败」与「返回了不合规内容」是两种不同的降级原因，混在一起就没法排查。
 *   3. API Key 只在本服务内使用，**绝不下发端上、绝不写日志**。
 */
@Injectable()
export class LlmService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 是否已配置可用（未配置时调用方直接降级，不产生一次必然失败的网络请求） */
  get configured(): boolean {
    const config = this.config();
    return Boolean(config.apiBase && config.apiKey && config.model);
  }

  get model(): string {
    return this.config().model;
  }

  /** 同步调用对话补全；失败抛错（含未配置、超时、HTTP 非 2xx、响应结构异常） */
  async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
    const config = this.config();
    if (!config.apiBase || !config.apiKey || !config.model) {
      throw new LlmNotConfiguredError();
    }

    const url = `${config.apiBase.replace(/\/+$/, '')}/chat/completions`;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: TEMPERATURE,
          stream: false,
        }),
        // Node 20 原生 AbortSignal.timeout：超时即中止，避免用户请求被挂住
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // ⚠️ 这里只记录错误类型与耗时，**不打请求体**（prompt 含用户数据，且日志里不该出现密钥）
      throw new Error(
        `模型调用失败类型=${error instanceof Error ? error.name : 'unknown'} 耗时=${Date.now() - startedAt}ms`,
      );
    }

    if (!response.ok) {
      // 上游错误正文可能含请求信息，只取状态码，避免把上游回显写进日志
      throw new Error(`模型返回 HTTP ${response.status} 耗时=${Date.now() - startedAt}ms`);
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('模型返回内容为空');
    }

    this.logger.log(
      `模型调用成功：model=${payload.model ?? config.model} 耗时=${Date.now() - startedAt}ms 字数=${[...content].length}`,
      'LlmService',
    );
    return { content, model: payload.model ?? config.model };
  }

  private config(): LlmConfig {
    return this.configService.get<LlmConfig>('llm') as LlmConfig;
  }
}
