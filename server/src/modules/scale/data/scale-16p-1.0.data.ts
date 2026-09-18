/**
 * 题库种子数据 · SCALE-16P-1.0（16 型人格图谱）
 *
 * 规格唯一真源：docs/constitution.md L423-L469「第二部分：16 型人格图谱（24 题，A/B 二选一）」
 * - L425：卷首文案（introText）
 * - L427-L469：4 个维度表格，每维度 6 题，共 24 题
 *
 * ⚠️ 关于 title 的说明：
 * 规格表格只给出每题 A 端 / B 端两个选项文案，**没有单独的题干**。
 * 因此本题库的 title 是**构造值**——统一使用固定问句「以下哪种更像你？」，
 * 由 options 提供该题真实的 A / B 两端文案（逐字照抄规格原文），
 * note 记录所属维度名。构造 title 不代表规格原文，A/B 端选项文案才是规格原文。
 *
 * 规格表列头括号内的倾向说明（如「A 端（社交倾向）」）只是维度说明，
 * 不属于选项文案，未写入 options.label。
 *
 * 16 型不产出 0-100 维度分（isScored = false），仅在 p16.engine.ts 里按四维度端点组合判型（规则 8）。
 */

import {
  P16_DIMENSION_CODES,
  SCALE_CODE_16P,
  SCALE_VERSION_1_0,
} from '../../../engines/scale/scale.constants.js';
import type { ScaleVersionSeed } from '../../../engines/scale/scale.types.js';

export const SCALE_16P_1_0: ScaleVersionSeed = {
  scaleCode: SCALE_CODE_16P,
  scaleName: '16 型人格图谱',
  scaleDescription: '通过四组二选一题目了解彼此的性格倾向组合，用于帮助双方理解差异、便于日常沟通。',
  version: SCALE_VERSION_1_0,
  itemCount: 24,
  introText: '凭直觉选，别犹豫，没有好坏之分。每题两个选项，选更像你的那个。',

  dimensions: [
    {
      code: P16_DIMENSION_CODES.ENERGY,
      name: '能量来源',
      orderNo: 1,
      isSensitive: false,
      isScored: false,
    },
    {
      code: P16_DIMENSION_CODES.INFO,
      name: '信息偏好',
      orderNo: 2,
      isSensitive: false,
      isScored: false,
    },
    {
      code: P16_DIMENSION_CODES.DECISION,
      name: '决策风格',
      orderNo: 3,
      isSensitive: false,
      isScored: false,
    },
    {
      code: P16_DIMENSION_CODES.LIFESTYLE,
      name: '生活方式',
      orderNo: 4,
      isSensitive: false,
      isScored: false,
    },
  ],

  questions: [
    // ===== 维度 A：能量来源（独处充电 ↔ 社交充电）（P1-P6） =====
    {
      code: 'P1',
      orderNo: 1,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '和几个好友聚一聚' },
        { key: 'B', label: '独处，或只和最亲近的人待着' },
      ],
      note: '能量来源',
    },
    {
      code: 'P2',
      orderNo: 2,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '找人说出来就想通了' },
        { key: 'B', label: '自己先消化，想好了再说' },
      ],
      note: '能量来源',
    },
    {
      code: 'P3',
      orderNo: 3,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '经常主动开启新话题' },
        { key: 'B', label: '更多是听和接话' },
      ],
      note: '能量来源',
    },
    {
      code: 'P4',
      orderNo: 4,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '找人聊聊天能回血' },
        { key: 'B', label: '独处安静才能回血' },
      ],
      note: '能量来源',
    },
    {
      code: 'P5',
      orderNo: 5,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '认识新朋友让我兴奋' },
        { key: 'B', label: '认识新朋友有点耗神' },
      ],
      note: '能量来源',
    },
    {
      code: 'P6',
      orderNo: 6,
      dimensionCode: P16_DIMENSION_CODES.ENERGY,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '边说边想，说出来才清楚' },
        { key: 'B', label: '想清楚了才说' },
      ],
      note: '能量来源',
    },

    // ===== 维度 B：信息偏好（事实细节 ↔ 可能性）（P7-P12） =====
    {
      code: 'P7',
      orderNo: 7,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '具体事实和细节' },
        { key: 'B', label: '直觉和整体感觉' },
      ],
      note: '信息偏好',
    },
    {
      code: 'P8',
      orderNo: 8,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '按顺序讲事情经过' },
        { key: 'B', label: '先讲感受和意义' },
      ],
      note: '信息偏好',
    },
    {
      code: 'P9',
      orderNo: 9,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '先看价格、面积、楼层' },
        { key: 'B', label: '先想象住进去的感觉' },
      ],
      note: '信息偏好',
    },
    {
      code: 'P10',
      orderNo: 10,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '按验证过的方法做' },
        { key: 'B', label: '喜欢尝试新方法' },
      ],
      note: '信息偏好',
    },
    {
      code: 'P11',
      orderNo: 11,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '聊具体的日常' },
        { key: 'B', label: '聊想法和可能性' },
      ],
      note: '信息偏好',
    },
    {
      code: 'P12',
      orderNo: 12,
      dimensionCode: P16_DIMENSION_CODES.INFO,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '希望步骤明确详细' },
        { key: 'B', label: '给个大方向就行' },
      ],
      note: '信息偏好',
    },

    // ===== 维度 C：决策风格（逻辑优先 ↔ 感受优先）（P13-P18） =====
    {
      code: 'P13',
      orderNo: 13,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '逻辑和公平' },
        { key: 'B', label: '感受和关系' },
      ],
      note: '决策风格',
    },
    {
      code: 'P14',
      orderNo: 14,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '先帮 TA 分析怎么办' },
        { key: 'B', label: '先共情接住 TA 的情绪' },
      ],
      note: '决策风格',
    },
    {
      code: 'P15',
      orderNo: 15,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '直接指出问题更有效' },
        { key: 'B', label: '委婉一点，照顾对方感受' },
      ],
      note: '决策风格',
    },
    {
      code: 'P16',
      orderNo: 16,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '讲道理更重要' },
        { key: 'B', label: '别伤感情更重要' },
      ],
      note: '决策风格',
    },
    {
      code: 'P17',
      orderNo: 17,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '列利弊清单' },
        { key: 'B', label: '问问自己在意的人怎么想' },
      ],
      note: '决策风格',
    },
    {
      code: 'P18',
      orderNo: 18,
      dimensionCode: P16_DIMENSION_CODES.DECISION,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '先看是否合理高效' },
        { key: 'B', label: '先看对每个人的影响' },
      ],
      note: '决策风格',
    },

    // ===== 维度 D：生活方式（计划确定 ↔ 灵活随性）（P19-P24） =====
    {
      code: 'P19',
      orderNo: 19,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '行程提前排好' },
        { key: 'B', label: '到了再看，随兴走' },
      ],
      note: '生活方式',
    },
    {
      code: 'P20',
      orderNo: 20,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '提前完成才安心' },
        { key: 'B', label: '压力下效率最高' },
      ],
      note: '生活方式',
    },
    {
      code: 'P21',
      orderNo: 21,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '东西各归其位才舒服' },
        { key: 'B', label: '乱一点没关系，找得到就行' },
      ],
      note: '生活方式',
    },
    {
      code: 'P22',
      orderNo: 22,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '计划被打乱会烦躁' },
        { key: 'B', label: '反而觉得有新鲜感' },
      ],
      note: '生活方式',
    },
    {
      code: 'P23',
      orderNo: 23,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '提前约好才踏实' },
        { key: 'B', label: '临时起意最开心' },
      ],
      note: '生活方式',
    },
    {
      code: 'P24',
      orderNo: 24,
      dimensionCode: P16_DIMENSION_CODES.LIFESTYLE,
      type: 'binary',
      title: '以下哪种更像你？',
      reverse: false,
      isStyle: false,
      isBaseline: false,
      options: [
        { key: 'A', label: '我是清单控' },
        { key: 'B', label: '清单写了也不怎么看' },
      ],
      note: '生活方式',
    },
  ],
};
