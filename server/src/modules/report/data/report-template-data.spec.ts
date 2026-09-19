import { DIMENSION_CODES, P16_DIMENSION_CODES } from '../../../engines/scale/scale.constants.js';
import { collectPlaceholders } from '../../../engines/report/template.engine.js';
import { SCALE_16P_1_0 } from '../../scale/data/scale-16p-1.0.data.js';
import { SCALE_PRE_1_0 } from '../../scale/data/scale-pre-1.0.data.js';
import { DOUBLE_BLOCK, REPORT_PLACEHOLDER, SHARE_FORBIDDEN_PLACEHOLDERS } from '../report.constants.js';
import type { ReportTemplateBlockSeed, ReportTemplateSeed } from '../report-seed.types.js';
import { DOUBLE_PRE_L1_TEMPLATE } from './double-pre-l1-template.data.js';
import { DOUBLE_PRE_L2_TEMPLATE } from './double-pre-l2-template.data.js';
import { DOUBLE_PRE_L3_TEMPLATE } from './double-pre-l3-template.data.js';
import { SINGLE_16P_TEMPLATE } from './single-16p-template.data.js';
import { SINGLE_PRE_LITE_TEMPLATE } from './single-lite-template.data.js';

/**
 * 报告模板种子自检（模块 4 单人 / 模块 5 双人）
 * 为什么在种子层就校验：这些是**规格硬指标**，一旦被改坏应在单测阶段拦下，
 *   而不是等导入到库、用户看到报告才发现（模型 3 的题库种子同样有此层校验）。
 */

/** 规格 2.3 必备文案（每个报告页脚固定，逐字一致） */
const REQUIRED_DISCLAIMER =
  '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。';

/** 价值感与内容标准 §一「简版对照」：维度解读 = 一句话点评 ≤30 字 */
const LITE_COMMENT_MAX_CHARS = 30;

/** 价值感与内容标准 §一「付费版对比报告」：维度解读每维度 300-500 字（此处校验下限） */
const FULL_COMMENT_MIN_CHARS = 300;

/** 按 Unicode 码点计数（与报告渲染的口径一致） */
const countChars = (text: string): number => [...text].length;

const ALL_TEMPLATES: ReportTemplateSeed[] = [
  SINGLE_PRE_LITE_TEMPLATE,
  SINGLE_16P_TEMPLATE,
  DOUBLE_PRE_L1_TEMPLATE,
  DOUBLE_PRE_L2_TEMPLATE,
  DOUBLE_PRE_L3_TEMPLATE,
];

/** 双人三层模板（L1/L2/L3），供分层断言复用 */
const DOUBLE_TEMPLATES: ReportTemplateSeed[] = [
  DOUBLE_PRE_L1_TEMPLATE,
  DOUBLE_PRE_L2_TEMPLATE,
  DOUBLE_PRE_L3_TEMPLATE,
];

/**
 * 各层渲染上下文提供的占位符白名单（与 DoubleReportRenderService.buildBaseContext 一一对应）
 * 为什么在种子层就按白名单卡：渲染侧对 L2/L3 采用 fail-closed —— 引用了上下文之外的键会**整块丢弃**，
 *   报告会静默少一段内容；把校验前移到单测，改文案时即可发现，而不是等用户看到缺块的报告。
 */
const L1_PLACEHOLDERS: readonly string[] = [
  REPORT_PLACEHOLDER.NICKNAME_A,
  REPORT_PLACEHOLDER.NICKNAME_B,
  REPORT_PLACEHOLDER.SCALE_VERSION,
  REPORT_PLACEHOLDER.CONSENSUS_LIST,
  REPORT_PLACEHOLDER.DIMENSION_NAME,
  REPORT_PLACEHOLDER.SCORE_A,
  REPORT_PLACEHOLDER.SCORE_B,
  REPORT_PLACEHOLDER.GAP,
  REPORT_PLACEHOLDER.GAP_LABEL,
  REPORT_PLACEHOLDER.PENDING_LIST,
  REPORT_PLACEHOLDER.DIVERGENCE_LIST,
  REPORT_PLACEHOLDER.UNEVALUATED_LIST,
  REPORT_PLACEHOLDER.BASELINE_NOTICE,
  REPORT_PLACEHOLDER.QUALITY_NOTICE,
];

const L2_PLACEHOLDERS: readonly string[] = [
  REPORT_PLACEHOLDER.NICKNAME_A,
  REPORT_PLACEHOLDER.NICKNAME_B,
  REPORT_PLACEHOLDER.SCALE_VERSION,
  REPORT_PLACEHOLDER.CONSENSUS_LIST,
  REPORT_PLACEHOLDER.BASELINE_NOTICE,
];

const L3_PLACEHOLDERS: readonly string[] = [
  REPORT_PLACEHOLDER.NICKNAME_A,
  REPORT_PLACEHOLDER.NICKNAME_B,
  REPORT_PLACEHOLDER.CONSENSUS_LIST,
  REPORT_PLACEHOLDER.DATE,
];

/** 模板内的全部占位符名（按首次出现顺序去重） */
function placeholdersOf(seed: ReportTemplateSeed): string[] {
  const seen = new Set<string>();
  for (const block of seed.blocks) {
    for (const key of collectPlaceholders(block.templateText)) seen.add(key);
  }
  return [...seen];
}

describe('报告模板种子结构（模块 4 / 模块 5）', () => {
  it.each(ALL_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：(blockKey, gapLevel) 与排序号唯一、文案非空',
    (_code, seed) => {
      // ⚠️ 唯一性必须按 (blockKey, gapLevel) 复合判定：双人完整版的维度解读同一 blockKey
      //    会有 high/mid/low 三行（ADR-005 决策 2），按单键去重会把 24 段解读判成重复
      const keys = seed.blocks.map((block) => `${block.blockKey}#${block.gapLevel ?? ''}`);
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

// ----------------------------------------------------------------- 模块 5：双人对比报告

/** 各层级模板 + 该层上下文允许的占位符白名单 */
const LAYER_CASES = [
  [DOUBLE_PRE_L1_TEMPLATE, L1_PLACEHOLDERS] as const,
  [DOUBLE_PRE_L2_TEMPLATE, L2_PLACEHOLDERS] as const,
  [DOUBLE_PRE_L3_TEMPLATE, L3_PLACEHOLDERS] as const,
];

/** L1 维度解读块（gapLevel 非空 = 分档解读） */
const L1_DIMENSION_BLOCKS: ReportTemplateBlockSeed[] = DOUBLE_PRE_L1_TEMPLATE.blocks.filter(
  (block) => block.gapLevel != null,
);

/** L1 必备区块键（规范增补 v0.2 §3.1 的 L1 内容清单） */
const L1_REQUIRED_BLOCKS: readonly string[] = [
  DOUBLE_BLOCK.INTRO,
  DOUBLE_BLOCK.RADAR,
  DOUBLE_BLOCK.PENDING,
  DOUBLE_BLOCK.DIVERGENCE,
  DOUBLE_BLOCK.CONSENSUS,
  DOUBLE_BLOCK.UNEVALUATED,
  DOUBLE_BLOCK.BASELINE_NOTICE,
  DOUBLE_BLOCK.QUALITY_NOTICE,
  DOUBLE_BLOCK.TALK_GUIDE,
  DOUBLE_BLOCK.ENDING,
];

describe('双人对比报告模板（模块 5）', () => {
  it.each(DOUBLE_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：audience=double，且 level 与模板编码尾缀一致（三层按 level 过滤，配错会取不到模板）',
    (_code, seed) => {
      expect(seed.audience).toBe('double');
      expect(seed.code.endsWith(`-${seed.level}`)).toBe(true);
    },
  );

  it.each(LAYER_CASES.map(([seed, allowed]) => [seed.code, seed, allowed] as const))(
    '%s：只使用本层上下文提供的占位符（越层引用会被渲染器整块丢弃）',
    (_code, seed, allowed) => {
      const used = placeholdersOf(seed);
      expect(used.length).toBeGreaterThan(0);
      for (const key of used) {
        expect(allowed).toContain(key);
      }
    },
  );

  it.each(DOUBLE_TEMPLATES.map((seed) => [seed.code, seed] as const))(
    '%s：分档区块只在 L1 出现（L2/L3 不呈现差值档位，R3 三层可见）',
    (_code, seed) => {
      for (const block of seed.blocks) {
        if (block.gapLevel == null) continue;
        expect(seed.level).toBe('L1');
        expect(block.blockKey).toBeTruthy();
      }
    },
  );

  it('L1：8 个计分维度 × 3 个差值档位 = 24 段解读，且每段都声明并满足 300 字下限', () => {
    // 8 维度 × 3 档（ADR-005 决策 2）；底线题组不参与维度分，不出现解读块
    expect(L1_DIMENSION_BLOCKS).toHaveLength(24);

    const codes = new Set(L1_DIMENSION_BLOCKS.map((block) => block.blockKey));
    expect(codes.size).toBe(8);
    expect(codes).not.toContain(DIMENSION_CODES.BASELINE);

    for (const block of L1_DIMENSION_BLOCKS) {
      expect(block.minChars).toBe(FULL_COMMENT_MIN_CHARS);
      // 引用完整性由渲染服务负责，此处只担保文案本身不短于「每维度 300-500 字」的下限
      expect(countChars(block.templateText)).toBeGreaterThanOrEqual(FULL_COMMENT_MIN_CHARS);
    }
  });

  it('L1：每个维度三个档位文案互不相同（分档必须真的分叉，而不是三行同一句话）', () => {
    const byCode = new Map<string, string[]>();
    for (const block of L1_DIMENSION_BLOCKS) {
      const texts = byCode.get(block.blockKey) ?? [];
      texts.push(block.templateText);
      byCode.set(block.blockKey, texts);
    }

    for (const [, texts] of byCode) {
      expect(texts).toHaveLength(3);
      expect(new Set(texts).size).toBe(3);
    }
  });

  it('L1：维度解读嵌入双方分数、差值与档位（差值口径解读 + 专属感）', () => {
    for (const block of L1_DIMENSION_BLOCKS) {
      for (const key of [
        REPORT_PLACEHOLDER.DIMENSION_NAME,
        REPORT_PLACEHOLDER.SCORE_A,
        REPORT_PLACEHOLDER.SCORE_B,
        REPORT_PLACEHOLDER.GAP,
        REPORT_PLACEHOLDER.GAP_LABEL,
        REPORT_PLACEHOLDER.NICKNAME_B,
      ]) {
        expect(block.templateText).toContain(`{${key}}`);
      }
    }
  });

  it('L1：每段维度解读都附 3 条可直接开口的问法（价值感标准 §一「对话建议 每维度 ≥3 条」）', () => {
    for (const block of L1_DIMENSION_BLOCKS) {
      const talkLines = block.templateText
        .split('\n')
        .filter((line) => line.startsWith('· '));
      expect(talkLines).toHaveLength(3);
      for (const line of talkLines) {
        // 问法必须是能直接说出口的句子，至少 10 个字，避免退化成关键词
        expect(countChars(line)).toBeGreaterThan(10);
      }
    }
  });

  it('L1：完整版区块齐备（雷达 / 待沟通 / 分歧 / 共识 / 未评估 / 底线 / 质量 / 沟通引导 / 结尾）', () => {
    const blockKeys = DOUBLE_PRE_L1_TEMPLATE.blocks.map((block) => block.blockKey);
    for (const key of L1_REQUIRED_BLOCKS) {
      expect(blockKeys).toContain(key);
    }
  });

  it('L1：结尾总结 ≥150 字（价值感标准 §一「一段 150 字总结文案」）', () => {
    const ending = DOUBLE_PRE_L1_TEMPLATE.blocks.find(
      (block) => block.blockKey === DOUBLE_BLOCK.ENDING,
    );

    expect(ending).toBeDefined();
    expect(countChars(ending?.templateText ?? '')).toBeGreaterThanOrEqual(150);
  });

  it('L2：包含纪念卡、共识区与「聊聊」入口，且不含任何差值/分歧类占位符', () => {
    const blockKeys = DOUBLE_PRE_L2_TEMPLATE.blocks.map((block) => block.blockKey);
    expect(blockKeys).toContain(DOUBLE_BLOCK.MEMORY_CARD);
    expect(blockKeys).toContain(DOUBLE_BLOCK.CONSENSUS);
    expect(blockKeys).toContain(DOUBLE_BLOCK.TALK_ENTRY);

    // 规范增补 v0.2 §3.2 规则 1：被邀请方不可见任何维度差值、分歧题目
    for (const block of DOUBLE_PRE_L2_TEMPLATE.blocks) {
      expect(block.templateText).not.toMatch(/\{(分数A|分数B|差值|档位|待沟通清单|分歧清单|未评估清单)\}/);
    }
  });

  it('L3：不含任何分享版禁用占位符（长图不出现分数，价值感标准 §二.5）', () => {
    for (const block of DOUBLE_PRE_L3_TEMPLATE.blocks) {
      for (const key of SHARE_FORBIDDEN_PLACEHOLDERS) {
        expect(block.templateText).not.toContain(`{${key}}`);
      }
    }
  });

  it('L3：标题区块存在（POST /reports/:id/share-image 的 title 取自 SHARE_TITLE 块）', () => {
    const title = DOUBLE_PRE_L3_TEMPLATE.blocks.find(
      (block) => block.blockKey === DOUBLE_BLOCK.SHARE_TITLE,
    );

    expect(title).toBeDefined();
    expect(title?.templateText).toContain(`{${REPORT_PLACEHOLDER.NICKNAME_A}}`);
    expect(title?.templateText).toContain(`{${REPORT_PLACEHOLDER.NICKNAME_B}}`);
  });
});
