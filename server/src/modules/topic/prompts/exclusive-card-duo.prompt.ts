import type { LlmMessage } from '../llm.service.js';
import { EXCLUSIVE_CARD_SYSTEM_ROLE } from '../topic.constants.js';

/**
 * 双人版专属卡 prompt（《锦囊卡片流 v1.0》§9.2 逐字实现，ADR-008 决策 1/2/3）
 *
 * 消息结构：`system` = §9.2【系统角色】；`user` = 【输入】+【输出要求】+【自检】。
 *   为什么拆两条而不是拼成一条：系统角色是**身份约束**（放 system 里模型遵守得更稳），
 *   输入与输出要求是**本次任务**；混在一起时输入段越长，"铁律"被稀释得越厉害。
 *
 * 可选段落的省略规则（「宁缺勿造」，ADR-008 决策 1 / 附带决策 4）：
 *   1. 某一方未做 16 型 → 只省略**该方**那一行，不编造类型名、prompt 里不残留 `{typeA}` 字样；
 *   2. 乙方未做 16 型 → 输出要求第 2 条同步去掉「符合乙方的决策风格」，
 *      否则等于要求模型为一个**未知风格**写「符合该风格」的话术；
 *   3. 所选维度内无量表题分歧 → 整段省略（决策 3：不退回全报告最大值，避免与「该维度得分」自相矛盾）。
 *   4. 输出要求第 1 条的「结合…」只列**实际存在**的信息来源，同上理由。
 *
 * 安全自查（铁律 #6「恶意用户会怎么攻击这里」）：
 *   - 本文件只做字符串拼装，不取数、不查库 —— 数据越权由调用方（ExclusiveCardService）
 *     按「当前用户是否为该邀请参与方」把关，prompt 层无从绕过。
 *   - 注入的全是**结论**（类型名 / 维度分 / 题干与选项文案），不含原始答案数组、不含 uid、不含订单信息；
 *     即使用户把昵称或答案写成指令注入，模型也只能在 180-250 字建议里体现，出口仍过禁词校验。
 */

/** 所选维度内分差最大的量表题（决策 3） */
export interface DuoPromptDivergence {
  /** 题干原文 */
  questionText: string;
  /** 甲方选项文案 */
  answerA: string;
  /** 乙方选项文案 */
  answerB: string;
}

/** 双人版 prompt 入参（全部为已取好的**结论**，不含原始答案） */
export interface DuoPromptInput {
  /** 议题名（§9.2 `{topic}`） */
  topicTitle: string;
  /** 甲方（发起方）人格类型描述，形如「守序者（决策风格：感受倾向）」；未做 16 型为 null */
  personaA: string | null;
  /** 乙方（被邀请方）人格类型描述；未做 16 型为 null */
  personaB: string | null;
  /** 所选维度的双方得分（0-100，一位小数） */
  scoreA: number;
  scoreB: number;
  /** 所选维度内分差最大的量表题；该维度无量表题分歧时为 null */
  divergence: DuoPromptDivergence | null;
}

/** §9.2【自检】段（原文逐字） */
const DUO_SELF_CHECK = '【自检】输出前检查：无禁用词、双方立场对等、可直接照说。';

/** 分数保留一位小数（与 `DimensionOutcome.score` 口径一致），避免 `62.300000000000004` 这类浮点噪音进 prompt */
function formatScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * 输出要求第 1 条：两处输入齐备时用 §9.2 原文逐字，
 * 缺人格类型 / 缺分歧题时只列实际存在的信息来源（「宁缺勿造」）。
 */
function styleDifferenceRequirement(hasPersona: boolean, hasDivergence: boolean): string {
  if (hasPersona && hasDivergence) {
    return '1. 一句话点出两人风格差异（结合人格类型与分歧题）';
  }
  const sources = ['该维度得分'];
  if (hasPersona) sources.push('人格类型');
  if (hasDivergence) sources.push('分歧题');
  return `1. 一句话点出两人风格差异（结合${sources.join('与')}）`;
}

/** 构造双人版 prompt（系统角色 + 本次任务） */
export function buildDuoPrompt(input: DuoPromptInput): LlmMessage[] {
  const inputs: string[] = [`议题：${input.topicTitle}`];
  if (input.personaA) inputs.push(`甲方（发起方）：人格类型 ${input.personaA}`);
  if (input.personaB) inputs.push(`乙方（被邀请方）：人格类型 ${input.personaB}`);
  inputs.push(
    `该维度得分：甲方 ${formatScore(input.scoreA)}/100，` +
      `乙方 ${formatScore(input.scoreB)}/100，` +
      `差值 ${formatScore(Math.abs(input.scoreA - input.scoreB))}`,
  );
  if (input.divergence) {
    inputs.push(`分歧最大的题目：${input.divergence.questionText}`);
    inputs.push(`甲方选项：${input.divergence.answerA}；乙方选项：${input.divergence.answerB}`);
  }

  // 乙方决策风格未知时不提「符合乙方的决策风格」（见文件头省略规则 2）
  const scriptRequirement = input.personaB
    ? '2. 给甲方 2 句"为乙方量身定制"的开场话术（符合乙方的决策风格）'
    : '2. 给甲方 2 句"为乙方量身定制"的开场话术';

  return [
    { role: 'system', content: EXCLUSIVE_CARD_SYSTEM_ROLE },
    {
      role: 'user',
      content: [
        '【输入】',
        ...inputs,
        '',
        '【输出要求】',
        '一段 180-250 字的专属对话建议，包含：',
        styleDifferenceRequirement(Boolean(input.personaA || input.personaB), Boolean(input.divergence)),
        scriptRequirement,
        '3. 一句温柔的提醒（把差异正常化，强化"能谈"的信心）',
        '',
        DUO_SELF_CHECK,
      ].join('\n'),
    },
  ];
}
