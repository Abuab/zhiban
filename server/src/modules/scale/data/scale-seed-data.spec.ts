/**
 * 题库种子数据核对（模块 3 完成标准：导入的题库与规格文件逐题一致）
 *
 * 本测试把 docs/constitution.md「题库 v1.0」的结构性事实固化为断言，防止后续
 * 编辑题库时把题数、标记或维度归属改坏。规格依据：
 * - 第一部分（L290-419）：8 维度 + 底线题组，题号 Q1-Q76
 * - 第二部分（L423-490）：16 型 24 题，题号 P1-P24
 * - 第三部分（L494-508）：计分与判定规则 1-8 条
 * - 阶段 0 裁决 D-3（题数以实际列出的 76 题为口径）、D-4（16 型纳入 P1）
 */
import {
  BASELINE_NOTICE_MESSAGE,
  DIMENSION_CODES,
  P16_DIMENSION_CODES,
  P16_ITEMS_PER_DIMENSION,
  P16_TYPE_NAMES,
  SCALE_CODE_16P,
  SCALE_CODE_PRE,
  SCALE_VERSION_1_0,
} from '../../../engines/scale/scale.constants.js';
import type { ScaleQuestion } from '../../../engines/scale/scale.types.js';
import { SCALE_16P_1_0 } from './scale-16p-1.0.data.js';
import { SCALE_PRE_1_0 } from './scale-pre-1.0.data.js';

/** 规格表格中「反向」列标 R 的题号（L296-404 逐行核对所得，共 19 道） */
const REVERSE_QUESTION_CODES = [
  'Q2', 'Q5', 'Q8', 'Q10', 'Q17', 'Q21', 'Q23', 'Q26', 'Q29', 'Q31',
  'Q35', 'Q39', 'Q42', 'Q47', 'Q50', 'Q53', 'Q58', 'Q61', 'Q70',
];

/** 规格中「类型」列为「选择」的题（分歧比对题） */
const CHOICE_QUESTION_CODES = ['Q3', 'Q37', 'Q38'];

/** 各维度的题数（规格 L295-416：维度 1-7 各 9 题、维度 8 为 8 题、底线 5 题） */
const EXPECTED_QUESTION_COUNT_BY_DIMENSION: Record<string, number> = {
  [DIMENSION_CODES.FINANCE]: 9,
  [DIMENSION_CODES.HOUSING]: 9,
  [DIMENSION_CODES.COMMUNICATION]: 9,
  [DIMENSION_CODES.FAMILY_BOUNDARY]: 9,
  [DIMENSION_CODES.PARENTING]: 9,
  [DIMENSION_CODES.CHORES]: 9,
  [DIMENSION_CODES.CAREER]: 9,
  [DIMENSION_CODES.INTIMACY]: 8,
};

/** 按 code 取题，取不到直接抛错（避免断言里出现 undefined 比较） */
function questionOf(questions: ScaleQuestion[], code: string): ScaleQuestion {
  const question = questions.find((item) => item.code === code);
  if (!question) throw new Error(`题库中缺少题目 ${code}`);
  return question;
}

describe('题库种子核对 · SCALE-PRE 婚前关系准备评估', () => {
  const questions = SCALE_PRE_1_0.questions;

  it('题数为 76，与 itemCount 一致，且题号 Q1-Q76 连续唯一', () => {
    expect(SCALE_PRE_1_0.scaleCode).toBe(SCALE_CODE_PRE);
    expect(SCALE_PRE_1_0.version).toBe(SCALE_VERSION_1_0);
    expect(questions).toHaveLength(76);
    expect(SCALE_PRE_1_0.itemCount).toBe(76);

    const expectedCodes = Array.from({ length: 76 }, (_, index) => `Q${index + 1}`);
    expect(questions.map((item) => item.code)).toEqual(expectedCodes);
    // orderNo 与题号一一对应：答题进度分母按此排序（假设 A-1）
    expect(questions.map((item) => item.orderNo)).toEqual(
      Array.from({ length: 76 }, (_, index) => index + 1),
    );
  });

  it('维度分布与规格一致：维度 1-7 各 9 题、维度 8 为 8 题、底线题组 5 题', () => {
    for (const [code, expected] of Object.entries(EXPECTED_QUESTION_COUNT_BY_DIMENSION)) {
      const actual = questions.filter((item) => item.dimensionCode === code).length;
      expect(actual, `维度 ${code} 的题数`).toBe(expected);
    }
    expect(questions.filter((item) => item.isBaseline)).toHaveLength(5);
  });

  it('维度编码集合完整（8 个计分维度 + 底线题组），且顺序号为 1-9', () => {
    expect(SCALE_PRE_1_0.dimensions.map((dimension) => dimension.code)).toEqual([
      DIMENSION_CODES.FINANCE,
      DIMENSION_CODES.HOUSING,
      DIMENSION_CODES.COMMUNICATION,
      DIMENSION_CODES.FAMILY_BOUNDARY,
      DIMENSION_CODES.PARENTING,
      DIMENSION_CODES.CHORES,
      DIMENSION_CODES.CAREER,
      DIMENSION_CODES.INTIMACY,
      DIMENSION_CODES.BASELINE,
    ]);
    expect(SCALE_PRE_1_0.dimensions.map((dimension) => dimension.orderNo)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('仅维度 8 为敏感维度，仅底线题组不参与维度分（B7 / 规则 6）', () => {
    const sensitive = SCALE_PRE_1_0.dimensions.filter((dimension) => dimension.isSensitive);
    expect(sensitive.map((dimension) => dimension.code)).toEqual([DIMENSION_CODES.INTIMACY]);

    const unscored = SCALE_PRE_1_0.dimensions.filter((dimension) => !dimension.isScored);
    expect(unscored.map((dimension) => dimension.code)).toEqual([DIMENSION_CODES.BASELINE]);
  });

  it('风格题仅 Q27 一道，且为量表题、参与维度归属（规则 2 不计入维度分）', () => {
    const styleQuestions = questions.filter((item) => item.isStyle);
    expect(styleQuestions.map((item) => item.code)).toEqual(['Q27']);
    expect(styleQuestions[0]?.type).toBe('scale');
    expect(styleQuestions[0]?.dimensionCode).toBe(DIMENSION_CODES.COMMUNICATION);
    // 题干只保留本体：规格题干括号内的「（风格题：不计入维度分…）」是给编辑的内部标注，
    // 该文案会直接下发到答题页，不得外露给用户
    expect(styleQuestions[0]?.title).toBe('吵架后，我通常需要一个冷静期才能好好谈。');
  });

  it('反向题清单与规格 R 标记完全一致（19 道）', () => {
    const actual = questions.filter((item) => item.reverse).map((item) => item.code);
    expect(actual).toEqual(REVERSE_QUESTION_CODES);
  });

  it('底线题组：恰为 Q72-Q76，且不挂维度、按量表 1-5 作答（规则 6）', () => {
    const baselineCodes = questions.filter((item) => item.isBaseline).map((item) => item.code);
    expect(baselineCodes).toEqual(['Q72', 'Q73', 'Q74', 'Q75', 'Q76']);

    for (const code of baselineCodes) {
      const question = questionOf(questions, code);
      expect(question.dimensionCode, `${code} 不应挂维度`).toBeNull();
      expect(question.type).toBe('scale');
      expect(question.options).toBeNull();
      expect(question.reverse).toBe(false);
    }
    // 无维度归属的题应当只有底线题组
    expect(questions.filter((item) => item.dimensionCode === null)).toHaveLength(5);
  });

  it('选择题恰为 Q3/Q37/Q38，选项数与规格一致（规则 3 分歧比对题）', () => {
    const choiceCodes = questions.filter((item) => item.type === 'choice').map((item) => item.code);
    expect(choiceCodes).toEqual(CHOICE_QUESTION_CODES);

    const expectedOptionCounts: Record<string, number> = { Q3: 5, Q37: 4, Q38: 4 };
    for (const [code, expectedCount] of Object.entries(expectedOptionCounts)) {
      const question = questionOf(questions, code);
      expect(question.options, `${code} 必须带选项`).not.toBeNull();
      expect(question.options).toHaveLength(expectedCount);
      // 选项键为 '1'..'n'，与题干中的 ①②③ 序号一一对应
      expect(question.options?.map((option) => option.key)).toEqual(
        Array.from({ length: expectedCount }, (_, index) => String(index + 1)),
      );
      for (const option of question.options ?? []) {
        expect(option.label.length, `${code} 选项文案不应为空`).toBeGreaterThan(0);
      }
    }
  });

  it('量表题不带选项，选择题/二选一题必带选项', () => {
    for (const question of questions) {
      if (question.type === 'scale') {
        expect(question.options, `${question.code} 量表题不应带选项`).toBeNull();
      } else {
        expect(question.options, `${question.code} 非量表题必须带选项`).not.toBeNull();
      }
    }
  });

  it('题干锚点与规格逐字一致（L299 / L301 / L418 处原文）', () => {
    expect(questionOf(questions, 'Q1').title).toBe(
      '婚前双方应互相坦白包括负债在内的全部财务状况。',
    );
    expect(questionOf(questions, 'Q72').title).toBe(
      '领证前，双方应互相确认彼此的婚姻登记史（未婚/离异/丧偶）。',
    );
  });

  it('卷首文案采用规格 L293 原文，底线提示文案与引擎常量同源', () => {
    expect(SCALE_PRE_1_0.introText).toContain('以下题目没有对错，请按你的真实想法作答');
    expect(SCALE_PRE_1_0.introText).toContain('涉及亲密的维度将单独征得你的同意');
    expect(BASELINE_NOTICE_MESSAGE).toBe(
      '你们对婚前事实确认的重视程度不同。这部分个人事实，建议在关系进入下一步前充分核实与确认。',
    );
  });

  it('底线题组独立卷首文案采用规格 L408 原文（ADR-004 落库字段）', () => {
    expect(SCALE_PRE_1_0.baselineIntroText).toBe(
      '以下几题关于婚前的事实确认，同样没有对错，请按你的真实想法作答。',
    );
    // 与整卷卷首文案必须不同：两者在答题页同时出现，同文会互相覆盖语义
    expect(SCALE_PRE_1_0.baselineIntroText).not.toBe(SCALE_PRE_1_0.introText);
  });
});

describe('题库种子核对 · SCALE-16P 16 型人格图谱', () => {
  const questions = SCALE_16P_1_0.questions;

  it('题数为 24，与 itemCount 一致，且题号 P1-P24 连续唯一', () => {
    expect(SCALE_16P_1_0.scaleCode).toBe(SCALE_CODE_16P);
    expect(SCALE_16P_1_0.version).toBe(SCALE_VERSION_1_0);
    expect(questions).toHaveLength(24);
    expect(SCALE_16P_1_0.itemCount).toBe(24);
    // 16 型无底线题组（规格 L423-L469 不含该分组），卷首文案为 null（ADR-004）
    expect(SCALE_16P_1_0.baselineIntroText).toBeNull();

    expect(questions.map((item) => item.code)).toEqual(
      Array.from({ length: 24 }, (_, index) => `P${index + 1}`),
    );
  });

  it('四维度各 6 题，顺序为 能量 → 信息 → 决策 → 生活', () => {
    expect(SCALE_16P_1_0.dimensions.map((dimension) => dimension.code)).toEqual([
      P16_DIMENSION_CODES.ENERGY,
      P16_DIMENSION_CODES.INFO,
      P16_DIMENSION_CODES.DECISION,
      P16_DIMENSION_CODES.LIFESTYLE,
    ]);
    for (const code of Object.values(P16_DIMENSION_CODES)) {
      expect(
        questions.filter((item) => item.dimensionCode === code),
        `维度 ${code} 的题数`,
      ).toHaveLength(P16_ITEMS_PER_DIMENSION);
    }
  });

  it('全部为二选一题，每题恰好 A / B 两端点文案，且不参与 0-100 维度分', () => {
    for (const question of questions) {
      expect(question.type, question.code).toBe('binary');
      expect(question.reverse, question.code).toBe(false);
      expect(question.isStyle, question.code).toBe(false);
      expect(question.isBaseline, question.code).toBe(false);
      expect(question.options?.map((option) => option.key), question.code).toEqual(['A', 'B']);
      for (const option of question.options ?? []) {
        expect(option.label.length, `${question.code} 端点文案不应为空`).toBeGreaterThan(0);
      }
    }
    expect(SCALE_16P_1_0.dimensions.every((dimension) => !dimension.isScored)).toBe(true);
  });

  it('端点文案锚点与规格一致（L430 第 1 题 / L469 第 24 题）', () => {
    expect(questionOf(questions, 'P1').options?.map((option) => option.label)).toEqual([
      '和几个好友聚一聚',
      '独处，或只和最亲近的人待着',
    ]);
    expect(questionOf(questions, 'P24').options?.map((option) => option.label)).toEqual([
      '我是清单控',
      '清单写了也不怎么看',
    ]);
  });

  it('类型命名表覆盖全部 16 种组合，且无官方代号外泄', () => {
    expect(Object.keys(P16_TYPE_NAMES)).toHaveLength(16);
    const blocked = ['INTJ', 'ENFP', 'MBTI', 'ISTJ'];
    for (const typeName of Object.values(P16_TYPE_NAMES)) {
      for (const token of blocked) {
        expect(typeName.includes(token), `${typeName} 不应包含官方代号 ${token}`).toBe(false);
      }
    }
  });
});

describe('题库种子核对 · 跨量表一致性', () => {
  it('题号在同量表内唯一，题干非空', () => {
    for (const seed of [SCALE_PRE_1_0, SCALE_16P_1_0]) {
      const codes = seed.questions.map((item) => item.code);
      expect(new Set(codes).size, `${seed.scaleCode} 题号应唯一`).toBe(codes.length);
      for (const question of seed.questions) {
        expect(question.title.trim().length, `${question.code} 题干不应为空`).toBeGreaterThan(0);
      }
    }
  });

  it('维度顺序号在同量表内唯一', () => {
    for (const seed of [SCALE_PRE_1_0, SCALE_16P_1_0]) {
      const orderNos = seed.dimensions.map((dimension) => dimension.orderNo);
      expect(new Set(orderNos).size, `${seed.scaleCode} 维度顺序号应唯一`).toBe(orderNos.length);
    }
  });
});
