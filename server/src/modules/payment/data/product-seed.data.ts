import { TOPICS } from '../../topic/topic.constants.js';
import { BENEFIT_TYPE_DOUBLE_REPORT, BENEFIT_TYPE_TOPIC, BENEFIT_TYPE_TOPIC_BUNDLE, PRODUCT_DOUBLE_INVITE, PRODUCT_TOPIC_BUNDLE, PRODUCT_TOPIC_SINGLE_PREFIX } from '../payment.constants.js';
import type { ProductBenefit } from '../payment.types.js';

/**
 * 商品种子（模块 6）
 *
 * 规格依据：
 *   - 宪法 §2.5 + ADR-007 决策 1：**P1 全免费**，故所有 `price = 0`；
 *     P2 恢复定价时只改数据（`--force` 重跑或后台改价），无需改代码
 *   - 定价 v0.2：双人对比报告 ¥8 / 单议题 ¥3 / 议题全包 ¥19.9（P2 值，此处不写入）
 *   - PRD-005 §4：iOS 隐藏虚拟商品购买入口 → `iosVisible = 0`（虚拟商品一律不展示）
 *
 * ⚠️ 为什么不把价格写进种子：P1 必须为 0，若种子写 8/3/19.9 再靠环境变量打折，
 *   就会出现「代码里躺着一个不会生效的价格」这种最难排查的错。定价属于**数据**，
 *   P2 上线时由运营在后台配置（宪法 P5）。
 */
export interface ProductSeed {
  code: string;
  name: string;
  /** 单位：元（库内口径）；P1 = 0 */
  price: number;
  benefits: ProductBenefit[];
  iosVisible: boolean;
}

/** 单议题商品名：`锦囊单议题·彩礼`（名称用于订单记录与微信账单描述，必须人能读懂） */
const singleTopicName = (title: string): string => `锦囊单议题·${title}`;

export const PRODUCT_SEEDS: readonly ProductSeed[] = [
  {
    code: PRODUCT_DOUBLE_INVITE,
    name: '双人对比报告解锁',
    price: 0,
    benefits: [{ type: BENEFIT_TYPE_DOUBLE_REPORT }],
    iosVisible: false,
  },
  {
    code: PRODUCT_TOPIC_BUNDLE,
    name: '锦囊议题全包',
    price: 0,
    // 全包展开为全部议题：权益判定时无需再查「全包包含哪些议题」，避免两处清单不同步
    benefits: [{ type: BENEFIT_TYPE_TOPIC_BUNDLE, topicCodes: TOPICS.map((topic) => topic.code) }],
    iosVisible: false,
  },
  // 每议题一行商品（ADR-007 附带决策 7：entitlement 只有 product_id，故把议题编码进商品本身）
  ...TOPICS.map(
    (topic): ProductSeed => ({
      code: `${PRODUCT_TOPIC_SINGLE_PREFIX}${topic.code}`,
      name: singleTopicName(topic.title),
      price: 0,
      benefits: [{ type: BENEFIT_TYPE_TOPIC, topicCode: topic.code }],
      iosVisible: false,
    }),
  ),
];
