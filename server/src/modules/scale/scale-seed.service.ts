import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { ScaleVersionSeed } from '../../engines/scale/scale.types.js';
import { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import { ScaleEntity } from './entities/scale.entity.js';
import { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import { ScaleVersionEntity } from './entities/scale-version.entity.js';
import { ScoringRuleEntity, type ScoringRuleLabels } from './entities/scoring-rule.entity.js';

/** 版本状态：冻结后不可编辑（B8/G1），导入即产出可作答的冻结版本 */
const STATUS_FROZEN = 'frozen';

/** 题目状态：on 上架 / off 下架（题目级开关 G1） */
const STATUS_ON = 'on';

/**
 * 默认计分规则取值（docs/schema.sql 第 338-353 行 scoring_rule 的列定义）
 * 说明：aggregate_method = mean_normalized 来自阶段 0 裁决 D-2；阈值 15/30 与 180 秒来自规则 5 / B3
 */
const DEFAULT_SCORING_RULE = {
  aggregateMethod: 'mean_normalized',
  diffThresholdHigh: 15,
  diffThresholdMid: 30,
  qualityMinSec: 180,
  version: '1.0',
  status: 'on',
} as const;

/**
 * 默认分级命名（中性，P7）
 * 来源：题库规格「计分与判定规则」第 5 条 —— <15 高共识 / 15-30 待沟通 / >30 重点待沟通
 *      （docs/constitution.md L500；docs/schema.sql L345 沿用同一组命名）
 * 说明：scale.constants.ts 目前未导出 DEFAULT_SCORING_RULE / 分级文案常量（该文件由引擎组维护，本模块不擅自改动），
 *      故在此定义具名常量，避免文案散落在服务逻辑里
 */
const DEFAULT_SCORING_RULE_LABELS: ScoringRuleLabels = {
  high: '高共识',
  mid: '待沟通',
  low: '重点待沟通',
};

/**
 * 量表种子导入服务（模块 3）
 * 职责：把 L1 引擎层的题库种子（ScaleVersionSeed，纯数据）幂等写入量表域四张表 + 计分规则默认行
 *
 * 幂等策略（对应 docs/schema.sql 的唯一键）：
 *   - scale：按 uk_code(code) 复用已有行，不重复插入
 *   - scale_version：按 uk_scale_version(scale_id, version) 判定 —— 已存在且未 force 时**不产生任何写入**
 *   - scoring_rule：按 uk_scale_version_rule(scale_version_id, version) 判定
 * 事务：单次导入的全部写入在同一事务内，避免留下「有版本没题目」的半成品数据
 */
@Injectable()
export class ScaleSeedService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 导入一个量表版本（含维度与题目）
   * 返回值：created 本次是否发生写入；skipped 是否因已存在而跳过；questionCount 该版本题目数
   */
  async seedVersion(
    seed: ScaleVersionSeed,
    options?: { force?: boolean },
  ): Promise<{ created: boolean; skipped: boolean; questionCount: number }> {
    this.assertItemCount(seed);
    const force = options?.force === true;

    return this.dataSource.transaction(async (manager) => {
      const scaleRepository = manager.getRepository(ScaleEntity);
      const versionRepository = manager.getRepository(ScaleVersionEntity);
      const dimensionRepository = manager.getRepository(ScaleDimensionEntity);
      const questionRepository = manager.getRepository(ScaleQuestionEntity);

      // 1. 量表主表：按 code 复用；名称/描述变更不在此处覆盖，避免导入脚本顺手改掉线上文案
      let scale = await scaleRepository.findOne({ where: { code: seed.scaleCode } });
      if (!scale) {
        scale = await scaleRepository.save(
          scaleRepository.create({
            code: seed.scaleCode,
            name: seed.scaleName,
            description: seed.scaleDescription,
          }),
        );
      }

      // 2. 版本判定（幂等核心）
      const existingVersion = await versionRepository.findOne({
        where: { scaleId: scale.id, version: seed.version },
      });

      if (existingVersion && !force) {
        const questionCount = await questionRepository.count({
          where: { scaleVersionId: existingVersion.id },
        });
        this.logger.log(
          `量表 ${seed.scaleCode} ${seed.version} 已存在，跳过导入（现有题目 ${questionCount} 道）；如需重建请显式传 force`,
          'ScaleSeedService',
        );
        return { created: false, skipped: true, questionCount };
      }

      if (existingVersion) {
        // 冻结版本重建会让进行中的邀请快照与新题目不一致（B8/G1），必须留痕后再执行
        if (existingVersion.status === STATUS_FROZEN) {
          this.logger.warn(
            `正在重建已冻结版本，进行中的邀请快照可能与题目不一致（B8/G1）：${seed.scaleCode} ${seed.version}（version_id=${existingVersion.id}）`,
            'ScaleSeedService',
          );
        }
        // 只删本版本的行，不影响同量表其他版本
        await questionRepository.delete({ scaleVersionId: existingVersion.id });
        await dimensionRepository.delete({ scaleVersionId: existingVersion.id });
      }

      // 3. 版本行：新建或就地重建（重建保留 version_id，已有引用不悬空）
      const frozenAt = new Date();
      let versionId: number;
      if (existingVersion) {
        await versionRepository.update(
          { id: existingVersion.id },
          { status: STATUS_FROZEN, itemCount: seed.itemCount, frozenAt },
        );
        versionId = existingVersion.id;
      } else {
        const createdVersion = await versionRepository.save(
          versionRepository.create({
            scaleId: scale.id,
            version: seed.version,
            status: STATUS_FROZEN,
            itemCount: seed.itemCount,
            frozenAt,
          }),
        );
        versionId = createdVersion.id;
      }

      // 4. 维度：一次批量插入，用回填的 id 建立 code → id 映射供题目挂靠
      const savedDimensions = await dimensionRepository.save(
        seed.dimensions.map((dimension) =>
          dimensionRepository.create({
            scaleVersionId: versionId,
            code: dimension.code,
            name: dimension.name,
            orderNo: dimension.orderNo,
            isSensitive: dimension.isSensitive ? 1 : 0,
            isScored: dimension.isScored ? 1 : 0,
          }),
        ),
      );
      const dimensionIdByCode = new Map<string, number>(
        savedDimensions.map((dimension) => [dimension.code, dimension.id]),
      );

      // 5. 题目：考察点 note 序列化进 ext_json；维度编码按映射转 dimension_id（底线题为 null）
      await questionRepository.save(
        seed.questions.map((question) =>
          questionRepository.create({
            scaleVersionId: versionId,
            dimensionId: question.dimensionCode
              ? (dimensionIdByCode.get(question.dimensionCode) ?? null)
              : null,
            code: question.code,
            orderNo: question.orderNo,
            type: question.type,
            title: question.title,
            reverse: question.reverse ? 1 : 0,
            isStyle: question.isStyle ? 1 : 0,
            isBaseline: question.isBaseline ? 1 : 0,
            optionsJson: question.options ?? null,
            extJson: question.note ? { note: question.note } : null,
            status: STATUS_ON,
          }),
        ),
      );

      // 6. 新版本即当前生效版本；force 重建已有版本时不改写 latest_version_id（不夺走当前指向）
      if (!existingVersion) {
        await scaleRepository.update({ id: scale.id }, { latestVersionId: versionId });
      }

      this.logger.log(
        `量表 ${seed.scaleCode} ${seed.version} 导入完成：维度 ${seed.dimensions.length} 个、题目 ${seed.questions.length} 道（version_id=${versionId}）`,
        'ScaleSeedService',
      );

      return { created: true, skipped: false, questionCount: seed.questions.length };
    });
  }

  /**
   * 写入默认计分行（幂等：同 scale_version_id + version 已存在则跳过）
   * labels 未传时用默认中文分级文案；显式传入用于运营改名后回填
   */
  async ensureDefaultScoringRule(
    scaleVersionId: number,
    labels?: ScoringRuleLabels,
  ): Promise<void> {
    const resolvedLabels = labels ?? DEFAULT_SCORING_RULE_LABELS;

    await this.dataSource.transaction(async (manager) => {
      const scoringRuleRepository = manager.getRepository(ScoringRuleEntity);
      const existing = await scoringRuleRepository.findOne({
        where: { scaleVersionId, version: DEFAULT_SCORING_RULE.version },
      });
      if (existing) {
        this.logger.log(
          `版本 ${scaleVersionId} 已存在计分规则 ${DEFAULT_SCORING_RULE.version}，跳过写入`,
          'ScaleSeedService',
        );
        return;
      }

      await scoringRuleRepository.save(
        scoringRuleRepository.create({
          scaleVersionId,
          aggregateMethod: DEFAULT_SCORING_RULE.aggregateMethod,
          diffThresholdHigh: DEFAULT_SCORING_RULE.diffThresholdHigh,
          diffThresholdMid: DEFAULT_SCORING_RULE.diffThresholdMid,
          labelsJson: resolvedLabels,
          qualityMinSec: DEFAULT_SCORING_RULE.qualityMinSec,
          version: DEFAULT_SCORING_RULE.version,
          status: DEFAULT_SCORING_RULE.status,
        }),
      );
      this.logger.log(
        `已写入版本 ${scaleVersionId} 的默认计分规则 ${DEFAULT_SCORING_RULE.version}`,
        'ScaleSeedService',
      );
    });
  }

  /** 题目数与 itemCount 必须一致：不一致会写出「进度分母对不上」的半成品版本（A-1），故拒绝写入 */
  private assertItemCount(seed: ScaleVersionSeed): void {
    if (seed.questions.length !== seed.itemCount) {
      throw new Error(
        `量表 ${seed.scaleCode} ${seed.version} 题目数与 itemCount 不一致：questions=${seed.questions.length}，itemCount=${seed.itemCount}，已中止导入`,
      );
    }
  }
}
