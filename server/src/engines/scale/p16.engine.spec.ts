import { P16_ITEMS_PER_DIMENSION, P16_TYPE_NAMES } from './scale.constants.js';
import { scoreP16 } from './p16.engine.js';
import type { AnswerMap, P16Pole, ScaleDimension, ScaleQuestion } from './scale.types.js';

/** 四维度卷内顺序：能量|信息|决策|生活 */
const P16_DIMENSION_ORDER = ['ENERGY', 'INFO', 'DECISION', 'LIFESTYLE'] as const;

/** 每维度题号：P1-P6 / P7-P12 / P13-P18 / P19-P24 → 便于按维度序号定位 */
const questionCodeOf = (dimensionIndex: number, itemIndex: number): string =>
  `P${dimensionIndex * P16_ITEMS_PER_DIMENSION + itemIndex + 1}`;

const buildDimensions = (): ScaleDimension[] =>
  P16_DIMENSION_ORDER.map((code, index) => ({
    code,
    name: `${code}-维度`,
    orderNo: index + 1,
    isSensitive: false,
    isScored: true,
  }));

const buildQuestions = (): ScaleQuestion[] =>
  buildDimensions().flatMap((dimension, dimensionIndex) =>
    Array.from({ length: P16_ITEMS_PER_DIMENSION }, (_, itemIndex): ScaleQuestion => {
      const orderNo = dimensionIndex * P16_ITEMS_PER_DIMENSION + itemIndex + 1;
      return {
        code: `P${orderNo}`,
        orderNo,
        dimensionCode: dimension.code,
        type: 'binary',
        title: `P${orderNo}`,
        reverse: false,
        isStyle: false,
        isBaseline: false,
        options: null,
      };
    }),
  );

/** 按「每维度选 A 的题数」生成答案（题干前 aCount 题选 A，其余选 B） */
const answersFromCounts = (aCounts: number[]): AnswerMap => {
  const answers: AnswerMap = {};
  aCounts.forEach((aCount, dimensionIndex) => {
    for (let itemIndex = 0; itemIndex < P16_ITEMS_PER_DIMENSION; itemIndex += 1) {
      answers[questionCodeOf(dimensionIndex, itemIndex)] =
        itemIndex < aCount ? 'A' : 'B';
    }
  });
  return answers;
};

const run = (aCounts: number[]) =>
  scoreP16({
    questions: buildQuestions(),
    dimensions: buildDimensions(),
    answers: answersFromCounts(aCounts),
  });

describe('scoreP16 · 规则 8 端点判定（constitution.md L503）', () => {
  it('aCount ≥4 取 A 端，≤2 取 B 端', () => {
    const result = run([6, 2, 4, 0]);

    expect(result.dimensions.map((dimension) => dimension.pole)).toEqual(['A', 'B', 'A', 'B']);
    expect(result.dimensions[0]).toMatchObject({ aCount: 6, bCount: 0, isTie: false });
    expect(result.dimensions[1]).toMatchObject({ aCount: 2, bCount: 4, isTie: false });
  });

  it('边界值：aCount = 4 取 A 端，aCount = 2 取 B 端（均非平局）', () => {
    const result = run([4, 2, 4, 2]);

    expect(result.dimensions.map((dimension) => dimension.pole)).toEqual(['A', 'B', 'A', 'B']);
    expect(result.dimensions.every((dimension) => dimension.isTie === false)).toBe(true);
    expect(result.typeKey).toBe('A|B|A|B');
  });
});

describe('scoreP16 · 平局（A-7：取 B 端并记录标记，architecture.md L358）', () => {
  it('aCount = 3 平局 → 取 B 端且 isTie = true', () => {
    const result = run([3, 3, 3, 3]);

    expect(result.dimensions.map((dimension) => dimension.pole)).toEqual(['B', 'B', 'B', 'B']);
    expect(result.dimensions[0]).toMatchObject({ aCount: 3, bCount: 3, pole: 'B', isTie: true });
    expect(result.dimensions.every((dimension) => dimension.isTie === true)).toBe(true);
    expect(result.typeKey).toBe('B|B|B|B');
    expect(result.typeName).toBe('心怀者');
  });

  it('平局标记只落在命中维度上', () => {
    [0, 1, 2, 3].forEach((tieIndex) => {
      const aCounts = [6, 0, 6, 0].map((count, index) => (index === tieIndex ? 3 : count));
      const result = run(aCounts);

      result.dimensions.forEach((dimension, index) => {
        if (index === tieIndex) {
          expect(dimension.pole).toBe('B');
          expect(dimension.isTie).toBe(true);
        } else {
          expect(dimension.isTie).toBe(false);
        }
      });
    });
  });
});

describe('scoreP16 · 未作答与非法答案', () => {
  it('按已答数判定，未答题不计入 aCount / bCount', () => {
    const answers: AnswerMap = { P1: 'A', P2: 'A', P3: 'B' }; // 其余全部未作答
    const result = scoreP16({ questions: buildQuestions(), dimensions: buildDimensions(), answers });

    expect(result.dimensions[0]).toMatchObject({
      dimensionCode: 'ENERGY',
      aCount: 2,
      bCount: 1,
      pole: 'B',
      isTie: false,
    });
    // 未作答兜底：已答数为 0 时判 B 端且不计平局
    expect(result.dimensions[1]).toMatchObject({ aCount: 0, bCount: 0, pole: 'B', isTie: false });
    expect(result.typeKey).toBe('B|B|B|B');
    expect(result.typeName).toBe('心怀者');
  });

  it('非法答案值（非 A/B / null）被忽略且不抛错', () => {
    const answers: AnswerMap = {
      P1: 'C',
      P2: 1,
      P3: null as unknown as string,
      P4: 'a',
      P5: 'A',
      P6: 'B',
    };
    const result = scoreP16({ questions: buildQuestions(), dimensions: buildDimensions(), answers });

    expect(result.dimensions[0]).toMatchObject({ aCount: 1, bCount: 1, pole: 'B', isTie: false });
    expect(result.dimensions[1]).toMatchObject({ aCount: 0, bCount: 0, isTie: false });
  });

  it('完全未作答时不抛错，四维度均判 B 端', () => {
    const result = scoreP16({ questions: buildQuestions(), dimensions: buildDimensions(), answers: {} });

    expect(result.dimensions.map((dimension) => dimension.pole)).toEqual(['B', 'B', 'B', 'B']);
    expect(result.dimensions.every((dimension) => dimension.isTie === false)).toBe(true);
  });
});

describe('scoreP16 · typeKey 顺序与类型名映射', () => {
  it('维度顺序按 orderNo 升序（与入参数组顺序无关）', () => {
    const result = scoreP16({
      questions: buildQuestions(),
      dimensions: buildDimensions().reverse(),
      answers: answersFromCounts([6, 0, 6, 0]),
    });

    expect(result.dimensions.map((dimension) => dimension.dimensionCode)).toEqual([
      'ENERGY',
      'INFO',
      'DECISION',
      'LIFESTYLE',
    ]);
    expect(result.typeKey).toBe('A|B|A|B');
  });

  it('显式覆盖「守序者」「领航者」「同行者」三个类型', () => {
    const orderly = run([0, 0, 6, 6]);
    expect(orderly.typeKey).toBe('B|B|A|A');
    expect(orderly.typeName).toBe('守序者');

    const navigator = run([6, 6, 6, 6]);
    expect(navigator.typeKey).toBe('A|A|A|A');
    expect(navigator.typeName).toBe('领航者');

    const companion = run([6, 6, 0, 0]);
    expect(companion.typeKey).toBe('A|A|B|B');
    expect(companion.typeName).toBe('同行者');
  });

  it('全部 16 种 A/B 组合都能映射到非空类型名', () => {
    const aCountOfPole: Record<P16Pole, number> = { A: 6, B: 0 };
    const typeKeys = Object.keys(P16_TYPE_NAMES);

    expect(typeKeys).toHaveLength(16);
    typeKeys.forEach((typeKey) => {
      const aCounts = typeKey
        .split('|')
        .map((pole) => aCountOfPole[pole as P16Pole]);
      const result = run(aCounts);

      expect(result.typeKey).toBe(typeKey);
      expect(result.typeName).toBe(P16_TYPE_NAMES[typeKey]);
      expect(result.typeName).not.toBe('');
    });
  });

  it('混合端点与平局的组合映射正确（A|B|B|A → 和事者）', () => {
    const result = run([5, 2, 3, 4]);

    expect(result.dimensions.map((dimension) => dimension.pole)).toEqual(['A', 'B', 'B', 'A']);
    expect(result.dimensions[2].isTie).toBe(true);
    expect(result.typeKey).toBe('A|B|B|A');
    expect(result.typeName).toBe('和事者');
  });
});
