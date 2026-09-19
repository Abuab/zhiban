import { DIMENSION_CODES, P16_DIMENSION_CODES } from '../../../engines/scale/scale.constants.js';
import { SCALE_16P_1_0 } from '../../scale/data/scale-16p-1.0.data.js';
import { SCALE_PRE_1_0 } from '../../scale/data/scale-pre-1.0.data.js';
import type { ReportTemplateSeed } from '../report-seed.types.js';
import { SINGLE_16P_TEMPLATE } from './single-16p-template.data.js';
import { SINGLE_PRE_LITE_TEMPLATE } from './single-lite-template.data.js';

/**
 * 报告模板种子自检（模块 4）
 * 为什么在种子层就校验：这些是**规格硬指标**，一旦被改坏应在单测阶段拦下，
 *   而不是等导入到库、用户看到报告才发现（模型 3 的题库种子同样有此层校验）。
 */

/** 规格 2.3 必备文案（每个报告页脚固定，逐字一致） */
const REQUIRED_DISCLAIMER =
  '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。';

/** 价值感与内容标准 §一「简版对照」：维度解读 = 一句话点评 ≤30 字 */
const LITE_COMMENT_MAX_CHARS = 30;

/** 按 Unicode 码点计数（与报告渲染的口径一致） */
const countChars = (text: string): number => [...text].length;

const ALL_TEMPLATES: ReportTemplateSeed[] = [SINGLE_PRE_LITE_TEMPLATE, SINGLE_16P_TEMPLATE];

describe('报告模板种子结构（模块 4）', () => {
  it.each(ALL_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：区块键与排序号唯一、文案非空',
    (_code, seed) => {
      const keys = seed.blocks.map((block) => block.blockKey);
      expect(new Set(keys).size).toBe(keys.length);

      const orderNos = seed.blocks.map((block) => block.orderNo);
      expect(new Set(orderNos).size).toBe(orderNos.length);

      for (const block of seed.blocks) {
        expect(block.templateText.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.each(ALL_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：页脚免责声明与规格 2.3 原文逐字一致',
    (_code, seed) => {
      expect(seed.disclaimer).toBe(REQUIRED_DISCLAIMER);
    },
  );

  it.each(ALL_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：引用的量表在题库种子中真实存在',
    (_code, seed) => {
      const scaleSeeds = [SCALE_PRE_1_0, SCALE_16P_1_0];
      const matched = scaleSeeds.find(
        (scale) => scale.scaleCode === seed.scaleCode && scale.version === seed.scaleVersion,
      );
      expect(matched).toBeDefined();
    },
  );

  it.each(ALL_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：文案不含 P7 禁词与分档措辞',
    (_code, seed) => {
      // P7 劝和不劝离：禁止关系否定与量化风险表述；同时禁止出现「高/中/低」分档措辞
      const forbidden = [
        '不合适',
        '不匹配',
        '危险信号',
        '劝分',
        '重新考虑',
        '离婚风险',
        '高风险',
        '中风险',
        '低风险',
      ];
      const texts = [seed.disclaimer, ...seed.blocks.map((block) => block.templateText)];
      for (const text of texts) {
        for (const word of forbidden) {
          expect(text).not.toContain(word);
        }
      }
    },
  );
});

describe('单人简版报告模板（婚前评估，模块 4 完成标准）', () => {
  it('开场白与付费墙占位块齐备，且 order_no 符合约定（INTRO=10 / LOCK_HINT=990）', () => {
    const intro = SINGLE_PRE_LITE_TEMPLATE.blocks.find((block) => block.blockKey === 'INTRO');
    const lock = SINGLE_PRE_LITE_TEMPLATE.blocks.find((block) => block.blockKey === 'LOCK_HINT');

    expect(intro?.orderNo).toBe(10);
    expect(lock?.orderNo).toBe(990);
  });

  it('8 个计分维度各有一条点评（定价规范：8 维度答题 + 雷达图 + 一句话点评）', () => {
    const scoredCodes = [
      DIMENSION_CODES.FINANCE,
      DIMENSION_CODES.HOUSING,
      DIMENSION_CODES.COMMUNICATION,
      DIMENSION_CODES.FAMILY_BOUNDARY,
      DIMENSION_CODES.PARENTING,
      DIMENSION_CODES.CHORES,
      DIMENSION_CODES.CAREER,
      DIMENSION_CODES.INTIMACY,
    ];

    const blockKeys = SINGLE_PRE_LITE_TEMPLATE.blocks.map((block) => block.blockKey);
    for (const code of scoredCodes) {
      expect(blockKeys).toContain(code);
    }
    // 底线题组不参与维度分，不应有独立点评块
    expect(blockKeys).not.toContain(DIMENSION_CODES.BASELINE);
  });

  it('每条维度点评 ≤30 字（价值感标准 §一「简版对照」硬指标）', () => {
    const scoredBlockKeys = new Set(Object.values(DIMENSION_CODES));

    for (const block of SINGLE_PRE_LITE_TEMPLATE.blocks) {
      if (!scoredBlockKeys.has(block.blockKey as never)) continue;
      expect(countChars(block.templateText)).toBeLessThanOrEqual(LITE_COMMENT_MAX_CHARS);
    }
  });

  it('简版报告不嵌昵称、不嵌分数（专属感 = 无昵称；避免文案随分数位数突破字数上限）', () => {
    for (const block of SINGLE_PRE_LITE_TEMPLATE.blocks) {
      // 无任何占位符：单人简版刻意不接受渲染上下文（ADR-004 决策 3.5）
      expect(block.templateText).not.toMatch(/\{[A-Za-z0-9_\u4e00-\u9fff]+\}/);
    }
  });

  it('付费墙占位只讲内容类别、不写会随数据变化的条数（避免文案过期）', () => {
    const lock = SINGLE_PRE_LITE_TEMPLATE.blocks.find((block) => block.blockKey === 'LOCK_HINT');

    expect(lock).toBeDefined();
    // 不出现「23 条对话建议」这类**随数据变化**的条数（维度数 8 是结构常量，不在此列）
    expect(lock?.templateText).not.toMatch(/\d+\s*条/);
    // 必须说明解锁后可获得什么（信息差可视化，价值感标准 §三）
    expect(lock?.templateText).toContain('双人对比报告');
  });
});

describe('16 型人格图谱报告模板', () => {
  it('开场白用「类型名」占位符，由引擎结果填充（不发明类型解读文案）', () => {
    const blocks = SINGLE_16P_TEMPLATE.blocks;

    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockKey).toBe('INTRO');
    expect(blocks[0].templateText).toContain('{类型名}');
  });

  it('无付费墙占位块（P1 全额免费，16 型不涉及双人解锁）', () => {
    const blockKeys = SINGLE_16P_TEMPLATE.blocks.map((block) => block.blockKey);
    expect(blockKeys).not.toContain('LOCK_HINT');
  });

  it('不出现官方类型代号（规格 2.2：禁止 MBTI/INTJ 等受保护名称）', () => {
    const codes = Object.values(P16_DIMENSION_CODES);
    expect(codes).toHaveLength(4);
    for (const block of SINGLE_16P_TEMPLATE.blocks) {
      expect(block.templateText).not.toMatch(/MBTI|INTJ|ENFP|DISC/);
    }
  });
});
