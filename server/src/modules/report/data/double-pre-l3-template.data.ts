import { SCALE_CODE_PRE, SCALE_VERSION_1_0 } from '../../../engines/scale/scale.constants.js';
import { DOUBLE_BLOCK } from '../report.constants.js';
import type { ReportTemplateSeed } from '../report-seed.types.js';

/**
 * 报告模板种子 · 双人分享版 L3（DOUBLE-PRE-L3，发起方生成分享长图）
 *
 * 规格唯一真源：
 * - constitution.md 规范增补 v0.2 §3.1：L3 = 可勾选内容的分享长图（默认仅含共识区与正向建议）
 * - PRD-002 R3：分享版由发起方生成，可勾选，默认仅共识区
 * - 《价值感与内容标准》§二.5：分享卡片首图只出现正向文案，**不出现分数**
 * - ADR-005 决策 4：P1 服务端只下发素材（blocks + watermark），长图由小程序端 canvas 合成
 *
 * ⚠️ 越层红线：L3 的渲染上下文只有 {昵称A} {昵称B} {共识清单} {日期}。
 *    模板里出现「分数 / 差值 / 档位 / 维度名 / 待沟通清单 / 分歧清单 / 未评估清单 / 底线提示 / 质量提示」
 *    任一占位符时，DoubleReportRenderService 会在渲染**前**扫描原始文本并**整块丢弃 + 告警**
 *    （SHARE_FORBIDDEN_PLACEHOLDERS，双保险），即分享长图绝不会出现分数类内容。
 *    改文案时请不要引入上述任何键。
 */
export const DOUBLE_PRE_L3_TEMPLATE: ReportTemplateSeed = {
  code: 'DOUBLE-PRE-L3',
  scaleCode: SCALE_CODE_PRE,
  scaleVersion: SCALE_VERSION_1_0,
  audience: 'double',
  level: 'L3',
  disclaimer:
    '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  version: SCALE_VERSION_1_0,
  blocks: [
    {
      blockKey: DOUBLE_BLOCK.SHARE_TITLE,
      orderNo: 10,
      minChars: null,
      templateText: '{昵称A} 与 {昵称B}\n我们认真聊了一次未来\n{日期}',
    },
    {
      blockKey: DOUBLE_BLOCK.SHARE_CONSENSUS,
      orderNo: 20,
      minChars: null,
      templateText: '这些事上，我们的答案是一样的：\n{共识清单}',
    },
    {
      blockKey: DOUBLE_BLOCK.SHARE_ENDING,
      orderNo: 30,
      minChars: null,
      templateText:
        '这张卡片只记录我们想法一致的部分。\n' +
        '还有一些话题，我们打算慢慢聊——愿意坐下来把话说完，比马上有一致答案更重要。',
    },
  ],
};
