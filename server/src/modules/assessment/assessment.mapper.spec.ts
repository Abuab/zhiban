import type { ScaleQuestion } from '../../engines/scale/scale.types.js';
import type { ScaleDimensionEntity } from '../scale/entities/scale-dimension.entity.js';
import type { ScaleQuestionEntity } from '../scale/entities/scale-question.entity.js';
import {
  buildProgress,
  collectAllSkippedQuestionCodes,
  collectSkippedQuestionCodes,
  findMissingQuestionCodes,
  findSkippedDimensionConflicts,
  normalizeAnswerValue,
  resolveSkippedDimensions,
  resolveSkippedQuestions,
  sanitizeAnswers,
  toPaperQuestions,
} from './assessment.mapper.js';

/**
 * 测评域入参净化与进度计算（模块 4）
 * 关注点：客户端提交的答案属不可信输入，必须按锁定版本的题目定义逐题净化，
 *   且「服务端认为已答」必须与「L1 引擎认为有效」是同一件事。
 */

const dimension = (overrides: Partial<ScaleDimensionEntity>): ScaleDimensionEntity =>
  ({
    id: 1,
    scaleVersionId: 1,
    code: 'FINANCE',
    name: '财务观与婚俗财务',
    orderNo: 1,
    isSensitive: 0,
    isScored: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as ScaleDimensionEntity;

const question = (overrides: Partial<ScaleQuestion>): ScaleQuestion => ({
  code: 'Q1',
  orderNo: 1,
  dimensionCode: 'FINANCE',
  type: 'scale',
  title: '题干',
  reverse: false,
  isStyle: false,
  isBaseline: false,
  options: null,
  ...overrides,
});

const questionEntity = (overrides: Partial<ScaleQuestionEntity>): ScaleQuestionEntity =>
  ({
    id: 1,
    scaleVersionId: 1,
    dimensionId: 1,
    code: 'Q1',
    orderNo: 1,
    type: 'scale',
    title: '题干',
    reverse: 0,
    isStyle: 0,
    isBaseline: 0,
    optionsJson: null,
    extJson: { note: '财务透明度' },
    status: 'on',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as ScaleQuestionEntity;

const choiceOptions = [
  { key: '1', label: '必要的心意与保障' },
  { key: '2', label: '习俗，量力而行' },
];

describe('normalizeAnswerValue 单题答案净化（口径与 L1 引擎一致）', () => {
  it('量表题只接受 1-5 的整数，其余（0 / 6 / 小数 / 字符串 / 空）一律视为未作答', () => {
    const scale = question({ code: 'Q1', type: 'scale' });

    expect(normalizeAnswerValue(scale, 1)).toBe(1);
    expect(normalizeAnswerValue(scale, 5)).toBe(5);
    for (const invalid of [0, 6, 2.5, '3', '', null, undefined, Number.NaN, true]) {
      expect(normalizeAnswerValue(scale, invalid)).toBeNull();
    }
  });

  it('二选一题只接受 A / B 字符串', () => {
    const binary = question({ code: 'P1', type: 'binary', options: null });

    expect(normalizeAnswerValue(binary, 'A')).toBe('A');
    expect(normalizeAnswerValue(binary, 'B')).toBe('B');
    for (const invalid of ['C', 'a', '1', 1, '', null]) {
      expect(normalizeAnswerValue(binary, invalid)).toBeNull();
    }
  });

  it('选择题必须命中选项键', () => {
    const choice = question({ code: 'Q3', type: 'choice', options: choiceOptions });

    expect(normalizeAnswerValue(choice, '1')).toBe('1');
    expect(normalizeAnswerValue(choice, '2')).toBe('2');
    // 越界选项 / 数字 / 空串均无效
    expect(normalizeAnswerValue(choice, '3')).toBeNull();
    expect(normalizeAnswerValue(choice, 1)).toBeNull();
    expect(normalizeAnswerValue(choice, '')).toBeNull();
  });

  it('选择题缺失选项定义时拒绝任何取值（fail-closed）', () => {
    const broken = question({ code: 'Q3', type: 'choice', options: null });

    expect(normalizeAnswerValue(broken, '1')).toBeNull();
  });
});

describe('sanitizeAnswers 整卷答案净化', () => {
  const questions: ScaleQuestion[] = [
    question({ code: 'Q1', orderNo: 1 }),
    question({ code: 'Q3', orderNo: 3, type: 'choice', options: choiceOptions }),
    question({ code: 'Q64', orderNo: 64, dimensionCode: 'INTIMACY' }),
    question({ code: 'P1', orderNo: 1, type: 'binary', dimensionCode: 'ENERGY' }),
  ];

  it('只保留合法答案，未知题号与非法取值进 ignoredCodes', () => {
    const result = sanitizeAnswers(questions, {
      Q1: 4,
      Q3: '2',
      P1: 'A',
      Q999: 3,
      Q1_typo: 5,
    });

    expect(result.answers).toEqual({ Q1: 4, Q3: '2', P1: 'A' });
    expect(result.ignoredCodes).toEqual(expect.arrayContaining(['Q999', 'Q1_typo']));
  });

  it('非法取值被丢弃（不会被当作已作答写入库）', () => {
    const result = sanitizeAnswers(questions, { Q1: 9, Q3: '3', P1: 'C' });

    expect(result.answers).toEqual({});
    expect(result.ignoredCodes).toHaveLength(3);
  });

  it('被跳过维度的题号即使提交了也丢弃（避免「声明跳过又偷偷作答」导致口径矛盾）', () => {
    const result = sanitizeAnswers(questions, { Q1: 4, Q64: 5 }, new Set(['Q64']));

    expect(result.answers).toEqual({ Q1: 4 });
    expect(result.ignoredCodes).toEqual(['Q64']);
  });

  it('answers 缺省时返回空答案且不报错', () => {
    expect(sanitizeAnswers(questions, undefined)).toEqual({ answers: {}, ignoredCodes: [] });
  });
});

describe('resolveSkippedDimensions 跳过维度校验（B7）', () => {
  const dimensions: ScaleDimensionEntity[] = [
    dimension({ id: 1, code: 'FINANCE', orderNo: 1, isSensitive: 0 }),
    dimension({ id: 8, code: 'INTIMACY', orderNo: 8, isSensitive: 1 }),
    dimension({ id: 9, code: 'BASELINE', orderNo: 9, isSensitive: 0, isScored: 0 }),
  ];

  it('只接受敏感维度编码', () => {
    const result = resolveSkippedDimensions(dimensions, ['INTIMACY']);

    expect(result.skipped).toEqual(['INTIMACY']);
    expect(result.invalid).toEqual([]);
  });

  it('普通维度不可跳过（否则用户可以跳过任意维度逃避作答）', () => {
    const result = resolveSkippedDimensions(dimensions, ['FINANCE', 'BASELINE']);

    expect(result.skipped).toEqual([]);
    expect(result.invalid).toEqual(['FINANCE', 'BASELINE']);
  });

  it('重复编码去重，空入参返回空数组', () => {
    expect(resolveSkippedDimensions(dimensions, ['INTIMACY', 'INTIMACY']).skipped).toEqual([
      'INTIMACY',
    ]);
    expect(resolveSkippedDimensions(dimensions, []).skipped).toEqual([]);
    expect(resolveSkippedDimensions(dimensions, undefined).skipped).toEqual([]);
  });
});

describe('resolveSkippedQuestions 逐题跳过白名单（ADR-013 决策 1）', () => {
  const dimensions: ScaleDimensionEntity[] = [
    dimension({ id: 1, code: 'FINANCE', orderNo: 1, isSensitive: 0 }),
    dimension({ id: 8, code: 'INTIMACY', orderNo: 8, isSensitive: 1 }),
    dimension({ id: 9, code: 'BASELINE', orderNo: 9, isSensitive: 0, isScored: 0 }),
  ];
  const questions: ScaleQuestion[] = [
    question({ code: 'Q1', orderNo: 1, dimensionCode: 'FINANCE' }),
    question({ code: 'Q27', orderNo: 27, dimensionCode: 'COMMUNICATION', isStyle: true }),
    question({ code: 'Q64', orderNo: 64, dimensionCode: 'INTIMACY' }),
    question({ code: 'Q65', orderNo: 65, dimensionCode: 'INTIMACY' }),
    // 底线题无维度归属（dimension_id 为空），不在敏感维度内
    question({ code: 'Q72', orderNo: 72, dimensionCode: null, isBaseline: true }),
  ];

  it('只接受「属于该卷锁定版本」且「所属维度 is_sensitive = 1」的题号', () => {
    const result = resolveSkippedQuestions(questions, dimensions, ['Q64', 'Q65']);

    expect(result.skipped).toEqual(['Q64', 'Q65']);
    expect(result.invalid).toEqual([]);
  });

  it('非敏感维度的题不可跳过（否则用户可借逐题跳过逃避作答）', () => {
    const result = resolveSkippedQuestions(questions, dimensions, ['Q1', 'Q27']);

    expect(result.skipped).toEqual([]);
    expect(result.invalid).toEqual(['Q1', 'Q27']);
  });

  it('底线题不可跳过（否则 R5 / B9 的底线题触发规则可被规避）', () => {
    const result = resolveSkippedQuestions(questions, dimensions, ['Q72']);

    expect(result.skipped).toEqual([]);
    expect(result.invalid).toEqual(['Q72']);
  });

  it('未知题号（不属于该卷锁定版本）一律拒绝，不静默忽略', () => {
    const result = resolveSkippedQuestions(questions, dimensions, ['Q999', 'Q64']);

    expect(result.skipped).toEqual(['Q64']);
    expect(result.invalid).toEqual(['Q999']);
  });

  it('重复题号去重，空入参返回空数组', () => {
    expect(resolveSkippedQuestions(questions, dimensions, ['Q64', 'Q64']).skipped).toEqual(['Q64']);
    expect(resolveSkippedQuestions(questions, dimensions, []).skipped).toEqual([]);
    expect(resolveSkippedQuestions(questions, dimensions, undefined).skipped).toEqual([]);
  });

  it('与 skippedDimensions 覆盖同一维度 → 互斥冲突（两种产品动作不得重叠）', () => {
    const conflicts = findSkippedDimensionConflicts(questions, ['INTIMACY'], ['Q64']);

    expect(conflicts).toEqual(['INTIMACY']);
  });

  it('两者不重叠时无冲突（不同维度，或任一为空）', () => {
    expect(findSkippedDimensionConflicts(questions, ['INTIMACY'], ['Q1'])).toEqual([]);
    expect(findSkippedDimensionConflicts(questions, [], ['Q64'])).toEqual([]);
    expect(findSkippedDimensionConflicts(questions, ['INTIMACY'], [])).toEqual([]);
  });

  it('两个跳过集合的并集是「不需作答」的唯一口径（进度 / 交卷 / 补答共用）', () => {
    const codes = collectAllSkippedQuestionCodes(questions, ['FINANCE'], ['Q64']);

    expect(codes).toEqual(new Set(['Q1', 'Q64']));
  });
});

describe('进度与完整性（B1 进度 / 交卷校验）', () => {
  const questions: ScaleQuestion[] = [
    question({ code: 'Q1', orderNo: 1 }),
    question({ code: 'Q2', orderNo: 2 }),
    question({ code: 'Q64', orderNo: 64, dimensionCode: 'INTIMACY' }),
    question({ code: 'Q65', orderNo: 65, dimensionCode: 'INTIMACY' }),
    question({ code: 'Q72', orderNo: 72, dimensionCode: null, isBaseline: true }),
  ];

  it('未跳过维度时分母 = 题目总数（A-1：SCALE-PRE-1.0 为 76）', () => {
    const progress = buildProgress(questions, { Q1: 3 }, new Set());

    expect(progress).toEqual({ answeredCount: 1, totalCount: 5, progressPercent: 20 });
  });

  it('跳过维度后分母扣除该维度题数（否则用户永远无法满足进度/交卷条件）', () => {
    const skippedCodes = collectSkippedQuestionCodes(questions, ['INTIMACY']);
    const progress = buildProgress(questions, { Q1: 3, Q2: 5, Q72: 4 }, skippedCodes);

    expect(skippedCodes).toEqual(new Set(['Q64', 'Q65']));
    expect(progress).toEqual({ answeredCount: 3, totalCount: 3, progressPercent: 100 });
  });

  it('被跳过维度的答案不计入分子（即使库里残留也保持一致）', () => {
    const skippedCodes = collectSkippedQuestionCodes(questions, ['INTIMACY']);
    const progress = buildProgress(questions, { Q1: 3, Q64: 5 }, skippedCodes);

    expect(progress.answeredCount).toBe(1);
    expect(progress.totalCount).toBe(3);
  });

  it('未作答题号按卷内顺序返回，跳过维度不出现在其中', () => {
    const skippedCodes = collectSkippedQuestionCodes(questions, ['INTIMACY']);
    const missing = findMissingQuestionCodes(questions, { Q1: 3 }, skippedCodes);

    expect(missing).toEqual(['Q2', 'Q72']);
  });

  it('题目总数为 0 时不产生除零（进度记 0）', () => {
    expect(buildProgress([], {}, new Set())).toEqual({
      answeredCount: 0,
      totalCount: 0,
      progressPercent: 0,
    });
  });
});

describe('toPaperQuestions 题目外发（运营字段不外泄）', () => {
  it('不下发 ext_json 的考察点，并解析出 dimensionCode', () => {
    const dimensions: ScaleDimensionEntity[] = [
      dimension({ id: 1, code: 'FINANCE', orderNo: 1 }),
      dimension({ id: 9, code: 'BASELINE', orderNo: 9, isScored: 0 }),
    ];
    const questions: ScaleQuestionEntity[] = [
      questionEntity({ id: 1, code: 'Q1', orderNo: 1, dimensionId: 1 }),
      questionEntity({
        id: 72,
        code: 'Q72',
        orderNo: 72,
        dimensionId: null,
        isBaseline: 1,
      }),
    ];

    const paper = toPaperQuestions(questions, dimensions);

    expect(paper.map((item) => item.code)).toEqual(['Q1', 'Q72']);
    expect(paper[0].dimensionCode).toBe('FINANCE');
    // 底线题组无维度归属（独立呈现，不参与维度分）
    expect(paper[1].dimensionCode).toBeNull();
    expect(paper[1].isBaseline).toBe(true);
    // 考察点是运营参考，不得出现在用户端数据结构里
    expect(Object.keys(paper[0])).not.toContain('note');
  });

  it('按 order_no 升序输出（答题顺序即此顺序）', () => {
    const dimensions: ScaleDimensionEntity[] = [dimension({ id: 1, code: 'FINANCE', orderNo: 1 })];
    const questions: ScaleQuestionEntity[] = [
      questionEntity({ id: 2, code: 'Q2', orderNo: 2, dimensionId: 1 }),
      questionEntity({ id: 10, code: 'Q10', orderNo: 10, dimensionId: 1 }),
      questionEntity({ id: 1, code: 'Q1', orderNo: 1, dimensionId: 1 }),
    ];

    expect(toPaperQuestions(questions, dimensions).map((item) => item.code)).toEqual([
      'Q1',
      'Q2',
      'Q10',
    ]);
  });
});
