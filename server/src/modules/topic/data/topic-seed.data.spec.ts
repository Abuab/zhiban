import { DIMENSION_CODES } from '../../../engines/scale/scale.constants.js';
import {
  CARD_TYPE_ACTION,
  CARD_TYPE_COGNITION,
  CARD_TYPE_PITFALL,
  CARD_TYPE_QUIZ,
  CARD_TYPE_SCRIPT,
  TOPICS,
} from '../topic.constants.js';
import { TOPIC_SEEDS } from './topic-seed.data.js';

/**
 * 议题种子数据回归保护（模块 7）
 *
 * 为什么给「纯数据」写单测：卡片正文是从《锦囊卡片流 v1.0》逐字转录的，
 *   转录出错（漏卡、漏选项、把解析塞进错误选项）不会造成任何编译错误或接口报错，
 *   只会让用户看到一段错内容 —— 这类错误必须靠断言兜住。
 *
 * 断言口径来自规格而非「当前数据长什么样」：
 *   - 《微内容标准》（增补 v0.3）：议题包 8-12 张卡（含最后一张专属卡）、每卡 ≤120 字、
 *     必含 坑卡 ≥2 / 话术卡 ≥3（长按复制）/ 演练卡 ≥1
 *   - 《锦囊卡片流 v1.0》§9.1：最后一卡为专属卡（落 exclusive_card 表，不在本种子内）
 *   - §9.5 CMS 格式：options = [{key, text, correct, explain}]
 */

const ALL_CARD_TYPES = [
  CARD_TYPE_PITFALL,
  CARD_TYPE_SCRIPT,
  CARD_TYPE_QUIZ,
  CARD_TYPE_COGNITION,
  CARD_TYPE_ACTION,
];

/** 微内容标准：每卡 ≤120 字 */
const MAX_BODY_LENGTH = 120;
/** 微内容标准：议题包 8-12 张卡；最后一张专属卡不在本种子里，故通用卡 7-11 张 */
const MIN_STANDARD_CARDS = 7;
const MAX_STANDARD_CARDS = 11;

describe('TOPIC_SEEDS（议题卡片种子）', () => {
  it('覆盖 TOPICS 里的全部议题且无重复', () => {
    const seedCodes = TOPIC_SEEDS.map((seed) => seed.code);
    expect(seedCodes).toHaveLength(TOPICS.length);
    expect(new Set(seedCodes).size).toBe(seedCodes.length);
    expect(new Set(seedCodes)).toEqual(new Set(TOPICS.map((meta) => meta.code)));
  });

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：卡序从 1 起连续递增',
    (_code, seed) => {
      expect(seed.cards.map((card) => card.orderNo)).toEqual(
        seed.cards.map((_card, index) => index + 1),
      );
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：通用卡 7-11 张（含最后一张专属卡后为 8-12 张）',
    (_code, seed) => {
      expect(seed.cards.length).toBeGreaterThanOrEqual(MIN_STANDARD_CARDS);
      expect(seed.cards.length).toBeLessThanOrEqual(MAX_STANDARD_CARDS);
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：必含 坑卡 ≥2 / 话术卡 ≥3 / 演练卡 ≥1（微内容标准）',
    (_code, seed) => {
      const countOf = (type: string) => seed.cards.filter((card) => card.cardType === type).length;
      expect(countOf(CARD_TYPE_PITFALL)).toBeGreaterThanOrEqual(2);
      expect(countOf(CARD_TYPE_SCRIPT)).toBeGreaterThanOrEqual(3);
      expect(countOf(CARD_TYPE_QUIZ)).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：卡类型必须合法，且不落 exclusive（专属卡由 exclusive_card 表承载）',
    (_code, seed) => {
      for (const card of seed.cards) {
        expect(ALL_CARD_TYPES).toContain(card.cardType);
        expect(card.cardType).not.toBe('exclusive');
      }
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：正文非空、≤120 字，且不含 markdown 强调标记（长按复制会把 * 带进聊天框）',
    (_code, seed) => {
      for (const card of seed.cards) {
        expect(card.body.trim()).not.toBe('');
        expect([...card.body].length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
        expect(card.body).not.toContain('*');
      }
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：话术卡必须可长按复制，非话术卡不得标记可复制',
    (_code, seed) => {
      for (const card of seed.cards) {
        if (card.cardType === CARD_TYPE_SCRIPT) {
          expect(card.copyable).toBe(true);
        } else {
          expect(card.copyable).toBeFalsy();
        }
      }
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：演练卡恰好一个正确选项，且正确选项带解析；非演练卡不得带选项',
    (_code, seed) => {
      for (const card of seed.cards) {
        if (card.cardType !== CARD_TYPE_QUIZ) {
          expect(card.options ?? null).toBeNull();
          continue;
        }

        const options = card.options ?? [];
        expect(options.length).toBeGreaterThanOrEqual(2);

        // 选项 key 唯一且非空（端上用它做选中态与答案比对）
        const keys = options.map((option) => option.key);
        expect(keys.every((key) => key.trim() !== '')).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);

        const correctOptions = options.filter((option) => option.correct);
        expect(correctOptions).toHaveLength(1);
        // 解析只挂在正确选项上（规格原稿的「解析：…」），端上点选后统一展示这条
        expect(correctOptions[0].explain.trim()).not.toBe('');

        for (const option of options) {
          expect(option.text.trim()).not.toBe('');
        }
      }
    },
  );

  it.each(TOPIC_SEEDS.map((seed) => [seed.code, seed] as const))(
    '议题 %s：话术卡必须带用途说明（对伴侣/对长辈等，规格括号内文字）',
    (_code, seed) => {
      for (const card of seed.cards) {
        if (card.cardType === CARD_TYPE_SCRIPT) {
          expect(card.title?.trim()).toBeTruthy();
        }
      }
    },
  );
});

describe('TOPICS（议题元数据）', () => {
  it('挂载维度必须来自量表维度编码，且 orderNo 从 0 起连续', () => {
    const validDimensions = new Set<string>(Object.values(DIMENSION_CODES));
    for (const meta of TOPICS) {
      expect(meta.mountDimensions.length).toBeGreaterThanOrEqual(1);
      for (const dimension of meta.mountDimensions) {
        expect(validDimensions.has(dimension)).toBe(true);
      }
    }
    expect(TOPICS.map((meta) => meta.orderNo)).toEqual(TOPICS.map((_meta, index) => index));
  });
});
