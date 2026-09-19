import {
  DIMENSION_CODES,
  SCALE_CODE_PRE,
  SCALE_VERSION_1_0,
} from '../../../engines/scale/scale.constants.js';
import type { ReportTemplateSeed } from '../report-seed.types.js';

/**
 * 报告模板种子 · 单人简版（SCALE-PRE-LITE-1.0）
 *
 * 规格唯一真源：
 * - docs/constitution.md 第 520-522 行：单人测评 + 简版报告免费，内容 = 8 维度答题 + 雷达图 + 一句话点评
 * - docs/constitution.md 第 73-75 行（2.3 必备文案）：页脚固定免责声明
 * - 《价值感与内容标准》§一「简版对照」：维度解读 = 一句话点评 ≤30 字；**无昵称**
 * - docs/adr/ADR-004.md 决策 3：block_key = 维度编码 + INTRO / LOCK_HINT
 *
 * 文案红线（P7 劝和不劝离）：只描述取向，不评判对错，不出现「不合适/不匹配/风险」等判词；
 *   也不出现「高/中/低」分档措辞 —— 规格未定义单人分数档位（ADR-004 决策 3.5）。
 *
 * ⚠️ 每条点评须 ≤30 字（价值感标准简版对照的硬指标），改动此处文案时同步跑单测校验。
 */
export const SINGLE_PRE_LITE_TEMPLATE: ReportTemplateSeed = {
  code: 'SINGLE-PRE-LITE',
  scaleCode: SCALE_CODE_PRE,
  scaleVersion: SCALE_VERSION_1_0,
  audience: 'single',
  level: 'L1',
  disclaimer:
    '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  version: SCALE_VERSION_1_0,
  blocks: [
    {
      blockKey: 'INTRO',
      orderNo: 10,
      minChars: null,
      templateText: '这是你的婚前关系准备评估结果，下面是 8 个维度的得分。',
    },
    {
      blockKey: DIMENSION_CODES.FINANCE,
      orderNo: 20,
      minChars: null,
      templateText: '你在钱财透明度与共同决策上的取向比较清晰。',
    },
    {
      blockKey: DIMENSION_CODES.HOUSING,
      orderNo: 30,
      minChars: null,
      templateText: '关于住房安排，你有自己看重的那部分。',
    },
    {
      blockKey: DIMENSION_CODES.COMMUNICATION,
      orderNo: 40,
      minChars: null,
      templateText: '你处理分歧时有自己的节奏和方式。',
    },
    {
      blockKey: DIMENSION_CODES.FAMILY_BOUNDARY,
      orderNo: 50,
      minChars: null,
      templateText: '在原生家庭与新家庭的边界上，你有自己的分寸。',
    },
    {
      blockKey: DIMENSION_CODES.PARENTING,
      orderNo: 60,
      minChars: null,
      templateText: '对生育与养育，你有自己的期待与节奏。',
    },
    {
      blockKey: DIMENSION_CODES.CHORES,
      orderNo: 70,
      minChars: null,
      templateText: '在家务分担上，你有自己认可的公平方式。',
    },
    {
      blockKey: DIMENSION_CODES.CAREER,
      orderNo: 80,
      minChars: null,
      templateText: '关于事业与家庭的平衡，你有自己的权衡。',
    },
    {
      blockKey: DIMENSION_CODES.INTIMACY,
      orderNo: 90,
      minChars: null,
      templateText: '你对亲密关系中的表达与经营有自己的期待。',
    },
    {
      // 付费墙锁定占位：只说明解锁后可获得的内容**类别**，不含内容本体，
      // 也不写会随数据变化的条数（如「23 条对话建议」）——避免文案随数据过期。
      blockKey: 'LOCK_HINT',
      orderNo: 990,
      minChars: null,
      templateText:
        '邀请对方一起完成同一份量表，就能解锁双人对比报告：8 个维度的深度解读、对话建议，以及你们的一致清单。',
    },
  ],
};
