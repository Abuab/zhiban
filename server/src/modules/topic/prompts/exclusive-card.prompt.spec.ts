import { EXCLUSIVE_CARD_SYSTEM_ROLE } from '../topic.constants.js';
import { buildDuoPrompt, type DuoPromptInput } from './exclusive-card-duo.prompt.js';
import { buildSoloPrompt, type SoloPromptInput } from './exclusive-card-solo.prompt.js';

/**
 * 专属卡 prompt 模板自检（模块 7，《锦囊卡片流 v1.0》§9.2 + ADR-008）
 *
 * 为什么值得单测：prompt 是**规格正文的逐字复制**，改文案等于改产品行为；
 *   且「哪一段该省略」是产品负责人裁决（ADR-008 决策 1/3、附带决策 4），
 *   靠人眼 review 容易漏（缺一段时模型会自行编造，而编造内容用户看不到问题）。
 */

/** §9.2 系统角色的铁律关键词（逐字取自规格，缺任一条即视为被改坏） */
const SYSTEM_ROLE_KEYWORDS = [
  '婚姻家庭沟通教练',
  '口语化、温暖、不说教',
  '立场绝对中立',
  '不评判谁对谁错',
  '不出现"不合适/劝分/风险"等',
  '不提供法律意见',
  '不制造焦虑',
];

/** 完整输入的双人版夹具（产品里最常见的形态：双方都做过 16 型、该维度有量表分歧） */
function fullDuoInput(): DuoPromptInput {
  return {
    topicTitle: '管钱',
    personaA: '守序者（决策风格：感受倾向）',
    personaB: '领航者（决策风格：逻辑倾向）',
    scoreA: 60.4,
    scoreB: 70.2,
    divergence: {
      questionText: '婚后收入应当合并管理。',
      answerA: '比较同意',
      answerB: '很不同意',
    },
  };
}

describe('专属卡 prompt：共用部分', () => {
  it('两版共用同一段 §9.2 系统角色，且铁律逐字保留', () => {
    const duo = buildDuoPrompt(fullDuoInput());
    const solo = buildSoloPrompt({ topicTitle: '管钱', persona: '守序者', score: 60 });

    expect(duo).toHaveLength(2);
    expect(solo).toHaveLength(2);
    expect(duo[0]).toEqual({ role: 'system', content: EXCLUSIVE_CARD_SYSTEM_ROLE });
    expect(solo[0]).toEqual(duo[0]);

    for (const keyword of SYSTEM_ROLE_KEYWORDS) {
      expect(EXCLUSIVE_CARD_SYSTEM_ROLE).toContain(keyword);
    }
  });

  it('两版都不残留未替换的占位符（{xxx} 形式）', () => {
    const contents = [
      ...buildDuoPrompt(fullDuoInput()).map((message) => message.content),
      ...buildSoloPrompt({ topicTitle: '管钱', persona: '守序者', score: 60 }).map((m) => m.content),
    ];
    for (const content of contents) {
      expect(content).not.toMatch(/\{[^}]*\}/);
    }
  });
});

describe('双人版 prompt', () => {
  it('输入段逐项注入：议题、双方人格类型、该维度得分、分歧题与双方选项', () => {
    const user = buildDuoPrompt(fullDuoInput())[1].content;

    expect(user).toContain('议题：管钱');
    expect(user).toContain('甲方（发起方）：人格类型 守序者（决策风格：感受倾向）');
    expect(user).toContain('乙方（被邀请方）：人格类型 领航者（决策风格：逻辑倾向）');
    expect(user).toContain('该维度得分：甲方 60.4/100，乙方 70.2/100，差值 9.8');
    expect(user).toContain('分歧最大的题目：婚后收入应当合并管理。');
    expect(user).toContain('甲方选项：比较同意；乙方选项：很不同意');
  });

  it('输入齐备时输出要求用 §9.2 原文逐字，自检含「双方立场对等」', () => {
    const user = buildDuoPrompt(fullDuoInput())[1].content;

    expect(user).toContain('一段 180-250 字的专属对话建议，包含：');
    expect(user).toContain('1. 一句话点出两人风格差异（结合人格类型与分歧题）');
    expect(user).toContain('2. 给甲方 2 句"为乙方量身定制"的开场话术（符合乙方的决策风格）');
    expect(user).toContain('3. 一句温柔的提醒（把差异正常化，强化"能谈"的信心）');
    expect(user).toContain('【自检】输出前检查：无禁用词、双方立场对等、可直接照说。');
  });

  it('双方都未做 16 型：省略两行人格类型，不编造、不出现 typeA/typeB', () => {
    const user = buildDuoPrompt({ ...fullDuoInput(), personaA: null, personaB: null })[1].content;

    expect(user).not.toContain('人格类型');
    expect(user).not.toContain('typeA');
    expect(user).not.toContain('typeB');
    // 乙方决策风格未知 → 去掉「符合乙方的决策风格」限定（但仍要求话术为乙方定制）
    expect(user).toContain('2. 给甲方 2 句"为乙方量身定制"的开场话术');
    expect(user).not.toContain('符合乙方的决策风格');
    // 风格差异要求只列实际存在的信息来源
    expect(user).toContain('1. 一句话点出两人风格差异（结合该维度得分与分歧题）');
  });

  it('仅乙方未做 16 型：只省略乙方那一行（甲方行保留）', () => {
    const user = buildDuoPrompt({ ...fullDuoInput(), personaB: null })[1].content;

    expect(user).toContain('甲方（发起方）：人格类型 守序者（决策风格：感受倾向）');
    expect(user).not.toContain('乙方（被邀请方）：人格类型');
  });

  it('仅甲方未做 16 型：只省略甲方那一行，且不要求「符合乙方决策风格」之外再加限定', () => {
    const user = buildDuoPrompt({ ...fullDuoInput(), personaA: null })[1].content;

    expect(user).toContain('乙方（被邀请方）：人格类型 领航者（决策风格：逻辑倾向）');
    expect(user).not.toContain('甲方（发起方）：人格类型');
    // 乙方已知风格 → 该限定保留
    expect(user).toContain('（符合乙方的决策风格）');
  });

  it('该维度无量表题分歧：整段省略（不退回全报告最大分歧题）', () => {
    const user = buildDuoPrompt({ ...fullDuoInput(), divergence: null })[1].content;

    expect(user).not.toContain('分歧最大的题目');
    expect(user).not.toContain('甲方选项');
    expect(user).toContain('该维度得分：甲方 60.4/100，乙方 70.2/100，差值 9.8');
    expect(user).toContain('1. 一句话点出两人风格差异（结合该维度得分与人格类型）');
  });

  it('分数与差值统一保留一位小数，不带浮点噪音', () => {
    const user = buildDuoPrompt({
      ...fullDuoInput(),
      scoreA: 62,
      scoreB: 62.1,
      divergence: null,
    })[1].content;

    expect(user).toContain('甲方 62.0/100，乙方 62.1/100，差值 0.1');
  });
});

describe('单人版 prompt', () => {
  const soloInput: SoloPromptInput = { topicTitle: '异地安排', persona: '守序者（决策风格：感受倾向）', score: 62 };

  it('结构性去掉乙方段落：全文不出现甲方/乙方字样', () => {
    const user = buildSoloPrompt(soloInput)[1].content;

    expect(user).not.toContain('甲方');
    expect(user).not.toContain('乙方');
    expect(user).not.toContain('分歧最大的题目');
  });

  it('输入段为「本人」，输出面向本人向伴侣开口', () => {
    const user = buildSoloPrompt(soloInput)[1].content;

    expect(user).toContain('议题：异地安排');
    expect(user).toContain('本人：人格类型 守序者（决策风格：感受倾向）');
    expect(user).toContain('本人维度得分：62.0/100');
    expect(user).toContain('1. 一句话点出你在该议题上的沟通风格特点（结合本人维度得分与人格类型）');
    expect(user).toContain('2. 给你 2 句可直接照说的开场话术（用你自己的语气，便于向伴侣开口）');
    expect(user).toContain('【自检】输出前检查：无禁用词、不评判对方、可直接照说。');
  });

  it('未做 16 型：省略人格类型行，且输出要求不再提人格类型', () => {
    const user = buildSoloPrompt({ ...soloInput, persona: null })[1].content;

    expect(user).not.toContain('人格类型');
    expect(user).toContain('本人维度得分：62.0/100');
    expect(user).toContain('1. 一句话点出你在该议题上的沟通风格特点（结合本人维度得分）');
  });
});
