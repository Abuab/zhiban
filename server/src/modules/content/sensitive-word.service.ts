import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SensitiveWordEntity, type SensitiveWordScope } from './entities/sensitive-word.entity.js';

/** 词表缓存时长（秒）：运营停用/新增词最迟 5 分钟生效，避免每次请求打库 */
const CACHE_TTL_SECONDS = 300;
const CACHE_KEY_PREFIX = 'cfg:sensitive_words:';

/**
 * 本地敏感词服务（内容域，宪法 P5 配置化）
 * 规格依据：边界总表 A6 —— 微信内容安全接口不可用时的本地兜底
 * 判定策略：仅做「结构化广告导流 + 违法类」的整词包含匹配。
 *          语义类判定交微信接口，避免本地词表误杀正常表达（如「约」这类高频字）。
 */
@Injectable()
export class SensitiveWordService {
  constructor(
    @InjectRepository(SensitiveWordEntity)
    private readonly repository: Repository<SensitiveWordEntity>,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  /** 命中则返回命中的词，未命中返回 null */
  async match(text: string, scope: SensitiveWordScope): Promise<string | null> {
    const normalized = text.toLowerCase();
    if (!normalized) return null;
    const words = await this.loadWords(scope);
    return words.find((word) => normalized.includes(word)) ?? null;
  }

  /** 按 scope 加载词表（含 all 通用词），结果缓存到 Redis */
  private async loadWords(scope: SensitiveWordScope): Promise<string[]> {
    const cacheKey = `${CACHE_KEY_PREFIX}${scope}`;
    const cached = await this.redis.getJson<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const rows = await this.repository.find({
        select: { word: true },
        where: { status: 'on', scope: In([scope, 'all']) },
      });
      const words = rows.map((row) => row.word.toLowerCase()).filter(Boolean);
      await this.redis.setJson(cacheKey, words, CACHE_TTL_SECONDS);
      return words;
    } catch (error) {
      // 词表不可用时返回空数组：只影响兜底能力，微信接口仍是主判定，不阻断业务流程
      this.logger.warn(
        `敏感词表加载失败，本次跳过本地兜底：${error instanceof Error ? error.message : String(error)}`,
        'SensitiveWordService',
      );
      return [];
    }
  }
}
