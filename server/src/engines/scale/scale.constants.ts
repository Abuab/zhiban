/**
 * L1 领域引擎层 · 量表常量
 *
 * 全部取值均出自规格原文，禁止在引擎实现中再次出现字面量。
 * 规格依据：
 * - 题库 v1.0 第三部分「计分与判定规则」1-8 条
 * - 题库 v1.0 第二部分「类型命名表（16 型自研命名）」
 * - 阶段 0 裁决 D-2（(均分 - 1) × 25）
 */

/** 量表编码 */
export const SCALE_CODE_PRE = 'SCALE-PRE';
export const SCALE_CODE_16P = 'SCALE-16P';

/** 量表版本号（规格第四部分：量表版本号 SCALE-PRE-1.0） */
export const SCALE_VERSION_1_0 = '1.0';

/** 维度编码（8 个计分维度，顺序与规格一致） */
export const DIMENSION_CODES = {
  FINANCE: 'FINANCE',
  HOUSING: 'HOUSING',
  COMMUNICATION: 'COMMUNICATION',
  FAMILY_BOUNDARY: 'FAMILY_BOUNDARY',
  PARENTING: 'PARENTING',
  CHORES: 'CHORES',
  CAREER: 'CAREER',
  INTIMACY: 'INTIMACY',
  /** 底线题组：独立呈现、单独计分、不参与维度分（规则 6） */
  BASELINE: 'BASELINE',
} as const;

/** 16 型维度编码（规则 8：四维度组合映射类型名） */
export const P16_DIMENSION_CODES = {
  ENERGY: 'ENERGY',
  INFO: 'INFO',
  DECISION: 'DECISION',
  LIFESTYLE: 'LIFESTYLE',
} as const;

/** 量表题分值边界（规则 1：很不同意=1 … 很同意=5） */
export const SCALE_VALUE_MIN = 1;
export const SCALE_VALUE_MAX = 5;

/** 维度分归一化系数（D-2：(均分 - 1) × 25 → 0-100） */
export const NORMALIZE_FACTOR = 25;

/** 逐题分歧判定：量表题同题 |分差| ≥ 3 记为分歧题（规则 4） */
export const SCALE_GAP_THRESHOLD = 3;

/** 每维度进入报告的逐题分歧上限（规则 4：按分差降序取前 2 题） */
export const TOP_DIVERGENCE_LIMIT = 2;

/** 16 型计分：每维度 6 题，A 端选择数 ≥4 取 A 端、≤2 取 B 端、=3 平局（规则 8） */
export const P16_POLE_A_MIN = 4;
export const P16_POLE_B_MAX = 2;
export const P16_ITEMS_PER_DIMENSION = 6;

/**
 * 16 型类型命名表（规格「类型命名表」原文，UI 不出现官方代号）
 * 键 = 能量|信息|决策|生活 四维端点组合
 */
export const P16_TYPE_NAMES: Readonly<Record<string, string>> = {
  'B|B|A|A': '守序者',
  'B|B|B|A': '温护者',
  'B|B|B|B': '心怀者',
  'B|B|A|B': '巧匠者',
  'B|A|B|A': '洞察者',
  'B|A|B|B': '引路人',
  'B|A|A|A': '远谋者',
  'B|A|A|B': '思辨者',
  'A|B|A|A': '执行官',
  'A|B|B|A': '和事者',
  'A|B|B|B': '热场者',
  'A|B|A|B': '行动者',
  'A|A|B|A': '点燃者',
  'A|A|A|B': '破局者',
  'A|A|A|A': '领航者',
  'A|A|B|B': '同行者',
};

/**
 * 底线题触发提示文案（规格 L418-419 原文）
 * 中性表述、不含关系判词，落实 P7 例外条款与假设 A-5（双方同一文案）
 */
export const BASELINE_NOTICE_MESSAGE =
  '你们对婚前事实确认的重视程度不同。这部分个人事实，建议在关系进入下一步前充分核实与确认。';

/** 低质量标记提示文案（规则 7 / B3 / B4 原文：「结果可能受作答状态影响」） */
export const LOW_QUALITY_NOTICE_MESSAGE = '结果可能受作答状态影响';

/** 低质量判定原因文案 */
export const LOW_QUALITY_REASON_LABELS: Readonly<Record<string, string>> = {
  too_fast: '作答时间过短',
  all_same: '全部题目选择相同',
};
