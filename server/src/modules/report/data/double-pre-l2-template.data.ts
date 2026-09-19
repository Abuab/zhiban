import { SCALE_CODE_PRE, SCALE_VERSION_1_0 } from '../../../engines/scale/scale.constants.js';
import { DOUBLE_BLOCK } from '../report.constants.js';
import type { ReportTemplateSeed } from '../report-seed.types.js';

/**
 * 报告模板种子 · 双人基础版 L2（DOUBLE-PRE-L2，被邀请方可见）
 *
 * 规格唯一真源：
 * - constitution.md 规范增补 v0.2 §3.1：L2 = 共同完成纪念卡、共识区内容（仅正向）、「有些话想和你聊聊」入口
 * - 规范增补 v0.2 §3.2 强制规则 1：被邀请方**不可见**任何维度差值、分歧题目、对方单人答案
 * - PRD-002 R3/R5/R8
 *
 * ⚠️ 本层渲染时使用**受限上下文**（DoubleReportRenderService.buildBaseContext）：
 *    可用占位符只有 {昵称A} {昵称B} {共识清单} {量表版本} {底线提示}。
 *    一旦这里误写 {分数A} / {差值} / {待沟通清单} 等，渲染会被判为越层引用并**整块丢弃**（fail-closed），
 *    报告里就会少一段内容 —— 改文案时务必只使用上述 5 个键。
 */
export const DOUBLE_PRE_L2_TEMPLATE: ReportTemplateSeed = {
  code: 'DOUBLE-PRE-L2',
  scaleCode: SCALE_CODE_PRE,
  scaleVersion: SCALE_VERSION_1_0,
  audience: 'double',
  level: 'L2',
  disclaimer:
    '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  version: SCALE_VERSION_1_0,
  blocks: [
    {
      blockKey: DOUBLE_BLOCK.INTRO,
      orderNo: 10,
      minChars: null,
      templateText:
        '{昵称A}，你和 {昵称B} 已经各自独立完成了同一份量表（版本 {量表版本}）。\n' +
        '这里是你可见的基础摘要：你们答案一致的部分，以及一句想和你说的话。\n' +
        '详细的对比分析由发起人持有，你看到的是这份基础版。',
    },
    {
      blockKey: DOUBLE_BLOCK.MEMORY_CARD,
      orderNo: 20,
      minChars: null,
      templateText:
        '共同完成纪念卡\n' +
        '{昵称A} × {昵称B}\n' +
        '你们没有互相商量，各自答完了同一份关于未来的题目。\n' +
        '这张卡片只记录一件事：你们愿意为彼此认真花一次时间。',
    },
    {
      blockKey: DOUBLE_BLOCK.CONSENSUS,
      orderNo: 30,
      minChars: null,
      templateText:
        '你们答案一致的部分（只列出你们选择相同的题目）：\n' +
        '{共识清单}\n' +
        '这些一致不是结论，但它们说明你们在很多事情上的第一反应是相同的，这会让接下来要聊的事轻一些。',
    },
    {
      blockKey: DOUBLE_BLOCK.TALK_ENTRY,
      orderNo: 40,
      minChars: null,
      templateText:
        '有些话想和你聊聊\n' +
        '这份摘要写到这里就够了。如果你也有一些想确认的事，可以找个合适的时间主动约对方聊一次。\n' +
        '不用一次把话说尽，能开口就已经很好。',
    },
    {
      blockKey: DOUBLE_BLOCK.BASELINE_NOTICE,
      orderNo: 50,
      minChars: null,
      templateText: '{底线提示}',
    },
    {
      blockKey: DOUBLE_BLOCK.ENDING,
      orderNo: 60,
      minChars: null,
      templateText:
        '谢谢 {昵称A} 愿意花时间完成这份量表。\n' +
        '一份关系里，最难得的不是想法完全一样，而是愿意把想法讲出来、也愿意听对方讲完。\n' +
        '如果你想了解更多，可以和发起人一起商量。',
    },
  ],
};
