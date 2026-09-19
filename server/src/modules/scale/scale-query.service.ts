import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { ErrorCode } from '../../common/constants/error-code.js';
import type { ScaleDimension, ScaleQuestion, ScoringRuleConfig } from '../../engines/scale/scale.types.js';
import { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import { ScaleEntity } from './entities/scale.entity.js';
import { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import { ScaleVersionEntity } from './entities/scale-version.entity.js';
import { ScoringRuleEntity } from './entities/scoring-rule.entity.js';
import { QUESTION_STATUS_ON, toEngineDimension, toEngineQuestions, toScoringRuleConfig } from './scale.mapper.js';

/**
 * 一次作答所需的完整量表快照（版本 + 维度 + 题目 + 计分规则）
 *
 * 计分规则可为空：只有「产出 0-100 维度分」的量表才需要它（如 SCALE-PRE）。
 *   16 型人格图谱用四个维度各 6 题的 A/B 端点组合出类型，**不产出维度分**，
 *   因此不写 scoring_rule 行（见 scripts/seed-scale.ts 的 SCALE_CODES_NEED_SCORING_RULE）。
 *   是否需要规则由消费方按场景判定，装载层不代替其做判断。
 */
export interface ScaleBundle {
  version: ScaleVersionEntity;
  scale: ScaleEntity;
  dimensions: ScaleDimensionEntity[];
  questions: ScaleQuestionEntity[];
  scoringRule: ScoringRuleEntity | null;
  /** 供 L1 引擎直接消费的纯数据 */
  engineDimensions: ScaleDimension[];
  engineQuestions: ScaleQuestion[];
  engineRule: ScoringRuleConfig | null;
}

/**
 * 量表域只读查询服务（模块 3 的能力出口，供报告域 / 测评域消费）
 *
 * 为什么单独拆出：写入侧是 ScaleSeedService（导入脚本用），读取侧是测评流程高频调用，
 *   两者生命周期与关注点不同；且 L1 引擎需要的是纯数据，读取侧负责实体→引擎类型的转换。
 */
@Injectable()
export class ScaleQueryService {
  constructor(
    @InjectRepository(ScaleEntity)
    private readonly scaleRepository: Repository<ScaleEntity>,
    @InjectRepository(ScaleVersionEntity)
    private readonly versionRepository: Repository<ScaleVersionEntity>,
    @InjectRepository(ScaleDimensionEntity)
    private readonly dimensionRepository: Repository<ScaleDimensionEntity>,
    @InjectRepository(ScaleQuestionEntity)
    private readonly questionRepository: Repository<ScaleQuestionEntity>,
    @InjectRepository(ScoringRuleEntity)
    private readonly scoringRuleRepository: Repository<ScoringRuleEntity>,
  ) {}

  /** 按量表编码 + 版本号查版本（量表主表不存在时返回 null） */
  async findVersionByCode(scaleCode: string, version: string): Promise<ScaleVersionEntity | null> {
    const scale = await this.scaleRepository.findOne({ where: { code: scaleCode } });
    if (!scale) return null;
    return this.versionRepository.findOne({ where: { scaleId: scale.id, version } });
  }

  /**
   * 按量表编码取「当前生效版本」（scale.latest_version_id 指向的版本）
   *
   * 新答卷必须锁到生效版本，而不是写死某个版本号：运营发布新版本后，
   *   新答卷自动用新版本，进行中的答卷仍用其 answer_sheet.scale_version_id（B6/B8）。
   */
  async findActiveVersionByScaleCode(scaleCode: string): Promise<ScaleVersionEntity | null> {
    const scale = await this.scaleRepository.findOne({ where: { code: scaleCode } });
    if (!scale || scale.latestVersionId === null) return null;
    return this.versionRepository.findOne({ where: { id: scale.latestVersionId } });
  }

  /** 按版本 id 查版本；不存在则抛业务异常 */
  async getVersionOrFail(scaleVersionId: number): Promise<ScaleVersionEntity> {
    const version = await this.versionRepository.findOne({ where: { id: scaleVersionId } });
    if (!version) {
      throw new BusinessException(ErrorCode.SCALE_NOT_FOUND, `量表版本不存在：${scaleVersionId}`);
    }
    return version;
  }

  /** 维度列表（按 order_no 升序） */
  listDimensions(scaleVersionId: number): Promise<ScaleDimensionEntity[]> {
    return this.dimensionRepository.find({
      where: { scaleVersionId },
      order: { orderNo: 'ASC' },
    });
  }

  /**
   * 题目列表（按 order_no 升序）
   * 默认只取 status = on 的题（G1：下架题不出现在新作答中）
   */
  listQuestions(scaleVersionId: number, options?: { includeOffline?: boolean }): Promise<ScaleQuestionEntity[]> {
    return this.questionRepository.find({
      where: options?.includeOffline
        ? { scaleVersionId }
        : { scaleVersionId, status: QUESTION_STATUS_ON },
      order: { orderNo: 'ASC' },
    });
  }

  /** 生效中的计分规则（同版本应唯一；多条时取 id 最大者） */
  async findActiveScoringRule(scaleVersionId: number): Promise<ScoringRuleEntity | null> {
    return this.scoringRuleRepository.findOne({
      where: { scaleVersionId, status: QUESTION_STATUS_ON },
      order: { id: 'DESC' },
    });
  }

  /**
   * 装载一次作答所需的全部量表数据
   * @param scaleVersionId 作答锁定的版本（answer_sheet.scale_version_id，B8 快照锚点）
   * @param options.includeOffline 是否包含已下架题（默认 false）
   *   —— 进行中的答题卷与历史报告必须传 true：G1 要求「进行中不受影响」，
   *      若按上架状态过滤，运营下架一道题会让正在作答的用户题目凭空消失、进度回退。
   *      「下架题不再出现在新答卷」由运营侧发新版本实现（模块 8 的题目下架流程）。
   */
  async loadBundle(
    scaleVersionId: number,
    options?: { includeOffline?: boolean },
  ): Promise<ScaleBundle> {
    const version = await this.getVersionOrFail(scaleVersionId);
    const [scale, dimensions, questions, scoringRule] = await Promise.all([
      this.scaleRepository.findOne({ where: { id: version.scaleId } }),
      this.listDimensions(scaleVersionId),
      this.listQuestions(scaleVersionId, { includeOffline: options?.includeOffline === true }),
      this.findActiveScoringRule(scaleVersionId),
    ]);

    if (!scale) {
      throw new BusinessException(ErrorCode.SCALE_NOT_FOUND, `量表主表不存在：scale_id=${version.scaleId}`);
    }
    // 计分规则允许缺失：不产出维度分的量表（16 型）本就没有该行，
    // 由消费方按场景判定是否需要（assessment.service 在婚前评估分支显式校验）

    return {
      version,
      scale,
      dimensions,
      questions,
      scoringRule,
      engineDimensions: dimensions.map(toEngineDimension),
      engineQuestions: toEngineQuestions(questions, dimensions),
      engineRule: scoringRule ? toScoringRuleConfig(scoringRule) : null,
    };
  }

  /** 按题号批量取题目（用于按 code 反查题干，报告渲染用） */
  findQuestionsByCodes(scaleVersionId: number, codes: string[]): Promise<ScaleQuestionEntity[]> {
    if (codes.length === 0) return Promise.resolve([]);
    return this.questionRepository.find({
      where: { scaleVersionId, code: In(codes) },
    });
  }
}
