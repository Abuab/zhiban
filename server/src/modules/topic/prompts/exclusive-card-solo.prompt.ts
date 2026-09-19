import type { LlmMessage } from '../llm.service.js';
import { EXCLUSIVE_CARD_SYSTEM_ROLE } from '../topic.constants.js';

/**
 * 单人版专属卡 prompt（ADR-007 决策 4 / ADR-008 附带决策 4）
 *
 * 与双人版的结构性差异（**不是把乙方字段留空，而是整段去掉**）：
 *   `【输入】` 无乙方行、`【输出要求】` 第 2 条改为「给你自己」的话术。
 *   理由：留空占位会让模型主动"补"一个对方出来（凭空编造对方立场与风格），
 *   而专属卡是要给用户照说出口的，编造的对方态度会直接伤人。
 *
 * 与双人版一致的部分：
 *   - 共用 §9.2【系统角色】（ADR-007 决策 4：降级为单人版不等于降低合规要求）；
 *   - 【自检】保留禁词与「可直接照说」，把「双方立场对等」改为「不评判对方」
 *     —— 单人版没有双方，对等无从检查，但「不评判对方」是该场景的核心红线。
 *
 * 数据来源：`answer_sheet(scene = 'single')` 的维度分 + `answer_sheet(scene = 'p16')` 的类型名；
 *   维度取议题 `mount_dimensions` 顺序**第一个已评估**者（2026-09-19 产品负责人裁决）。
 *   两者都没有时**不具备生成条件**，由调用方降级（`reason = 'no_dimension_data'`），不会走到本文件。
 */

/** 单人版 prompt 入参 */
export interface SoloPromptInput {
  /** 议题名 */
  topicTitle: string;
  /** 本人人格类型描述，形如「守序者（决策风格：感受倾向）」；未做 16 型为 null */
  persona: string | null;
  /** 本人该议题挂载维度（第一个已评估者）的得分（0-100，一位小数） */
  score: number;
}

/** §9.2【自检】段的单人版措辞（见文件头说明） */
const SOLO_SELF_CHECK = '【自检】输出前检查：无禁用词、不评判对方、可直接照说。';

/** 分数保留一位小数，与 `DimensionOutcome.score` 口径一致 */
function formatScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** 构造单人版 prompt（系统角色 + 本次任务） */
export function buildSoloPrompt(input: SoloPromptInput): LlmMessage[] {
  const inputs: string[] = [`议题：${input.topicTitle}`];
  if (input.persona) inputs.push(`本人：人格类型 ${input.persona}`);
  inputs.push(`本人维度得分：${formatScore(input.score)}/100`);

  // 未做 16 型时不提「人格类型」，避免要求模型结合不存在的数据（「宁缺勿造」）
  const styleRequirement = input.persona
    ? '1. 一句话点出你在该议题上的沟通风格特点（结合本人维度得分与人格类型）'
    : '1. 一句话点出你在该议题上的沟通风格特点（结合本人维度得分）';

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
        styleRequirement,
        '2. 给你 2 句可直接照说的开场话术（用你自己的语气，便于向伴侣开口）',
        '3. 一句温柔的提醒（把差异正常化，强化"能谈"的信心）',
        '',
        SOLO_SELF_CHECK,
      ].join('\n'),
    },
  ];
}
