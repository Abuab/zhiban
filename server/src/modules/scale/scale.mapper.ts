import type {
  QuestionOption,
  QuestionType,
  ScaleDimension,
  ScaleQuestion,
  ScoringRuleConfig,
} from '../../engines/scale/scale.types.js';
import type { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import type { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import type { ScoringRuleEntity } from './entities/scoring-rule.entity.js';

/**
 * 量表域实体 → L1 引擎类型的映射层（纯函数，无副作用）
 *
 * 为什么需要这一层：docs/architecture.md §2 硬约束规定 L1 引擎只接受纯数据结构，
 *   禁止 import DB 相关模块。业务服务从库里读出实体后，必须经此层转换再喂给引擎。
 */

/** 题目状态：on 上架 / off 下架（G1） */
export const QUESTION_STATUS_ON = 'on';

/** 实体 → 引擎题目 */
export function toEngineQuestion(
  entity: ScaleQuestionEntity,
  dimensionCodeById: ReadonlyMap<number, string>,
): ScaleQuestion {
  return {
    code: entity.code,
    orderNo: entity.orderNo,
    // 底线题组 dimension_id 为空 → dimensionCode 为 null（独立呈现，规则 6）
    dimensionCode: entity.dimensionId === null ? null : (dimensionCodeById.get(entity.dimensionId) ?? null),
    type: entity.type as QuestionType,
    title: entity.title,
    reverse: entity.reverse === 1,
    isStyle: entity.isStyle === 1,
    isBaseline: entity.isBaseline === 1,
    options: (entity.optionsJson as QuestionOption[] | null) ?? null,
    note: entity.extJson?.note,
  };
}

/** 实体列表 → 引擎题目列表 */
export function toEngineQuestions(
  entities: ScaleQuestionEntity[],
  dimensions: ScaleDimensionEntity[],
): ScaleQuestion[] {
  const dimensionCodeById = buildDimensionCodeMap(dimensions);
  return entities.map((entity) => toEngineQuestion(entity, dimensionCodeById));
}

/** 实体 → 引擎维度 */
export function toEngineDimension(entity: ScaleDimensionEntity): ScaleDimension {
  return {
    code: entity.code,
    name: entity.name,
    orderNo: entity.orderNo,
    isSensitive: entity.isSensitive === 1,
    isScored: entity.isScored === 1,
  };
}

/** 实体 → 引擎计分规则配置（引擎只接受纯数据） */
export function toScoringRuleConfig(entity: ScoringRuleEntity): ScoringRuleConfig {
  return {
    // 当前仅支持 mean_normalized（D-2）；库中若出现其他值，引擎侧会按其分支报错而非静默降级
    aggregateMethod: 'mean_normalized',
    diffThresholdHigh: entity.diffThresholdHigh,
    diffThresholdMid: entity.diffThresholdMid,
    labels: {
      high: entity.labelsJson?.high ?? '',
      mid: entity.labelsJson?.mid ?? '',
      low: entity.labelsJson?.low ?? '',
    },
    qualityMinSec: entity.qualityMinSec,
  };
}

/** 维度 id → 维度编码 映射 */
export function buildDimensionCodeMap(
  dimensions: ScaleDimensionEntity[],
): ReadonlyMap<number, string> {
  return new Map(dimensions.map((dimension) => [dimension.id, dimension.code]));
}
