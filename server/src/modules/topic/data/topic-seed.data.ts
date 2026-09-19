import {
  CARD_TYPE_ACTION,
  CARD_TYPE_COGNITION,
  CARD_TYPE_PITFALL,
  CARD_TYPE_QUIZ,
  CARD_TYPE_SCRIPT,
  TOPIC_CODES,
  type TopicCode,
} from '../topic.constants.js';
import type { TopicCardOption } from '../entities/topic-card.entity.js';

/**
 * 8 议题卡片流种子数据（模块 7，ADR-007）
 *
 * 规格依据：《锦囊卡片流 v1.0》议题 01-08 全文（docs/constitution.md 第 939-1193 行）。
 *
 * 两条工程约定（都是为了让端上不做额外解析）：
 *   1. **正文按纯文本落库**：规格原稿里的 `**` 强调标记不落库 ——
 *      话术卡支持「长按复制」，正文含 markdown 标记会让用户复制到聊天框时带上星号。
 *   2. **演练卡的 解析 放在正确选项的 explain**：选项正文（含自带的「（代价说明）」）逐字保留，
 *      `explain` 只承载该题的「解析：…」。端上点选后无论对错都展示这条解析条。
 *
 * ⚠️ 议题标题 / 副标题 / 排序 / 挂载维度**不在此文件**：唯一真源是 topic.constants.ts 的 TOPICS，
 *    否则商品种子（`topic_single:<code>`）与本文件会出现两份议题清单。
 */

export interface TopicCardSeed {
  /** 卡序（从 1 起，与规格的「卡1/卡2…」一致） */
  orderNo: number;
  cardType: string;
  /** 括号里的用途说明，如「对伴侣，摸底」；无则 null */
  title: string | null;
  body: string;
  copyable?: boolean;
  options?: TopicCardOption[];
}

export interface TopicSeed {
  code: TopicCode;
  cards: TopicCardSeed[];
}

export const TOPIC_SEEDS: readonly TopicSeed[] = [
  // ---------------------------------------------------------------- 议题 01
  {
    code: TOPIC_CODES.BETROTHAL_GIFT,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '饭桌上长辈刚提彩礼，你抢着说："现在年轻人不讲究这些。"\n' +
          '💥 一分钟内，对方父母会觉得女儿被"降价处理"。第一分钟的底线：不当长辈的面否定彩礼话题本身。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '直接还价："18.8 万太多了，10 万行不行？"\n' +
          '💥 砍价式回应把婚事谈成买卖，还顺手贬了对方家乡的规矩。行情地区谈判的对象从来不是数字本身。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_COGNITION,
        title: null,
        body:
          '行情固化的地区（如 18.8 万+车房+五金），要谈的不是"给不给"，而是"怎么给"。\n' +
          '四个可谈变量：金额能否拆、形式怎么算、什么时间给、最后归谁用。数字是死的，结构是活的。',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '对伴侣，摸底',
        copyable: true,
        body:
          '"你们那边现在具体什么行情？彩礼、五金、车房都怎么算？' +
          "咱俩先把'当地标准清单'完整列出来，再看每一项里哪些有空间。\"",
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '对伴侣，定调',
        copyable: true,
        body:
          '"行情我们认，这是诚意。但我想和你商量\'怎么给\'——是一次到位还是分步，' +
          '车房写谁、怎么个流程，最后这笔钱落到哪。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_SCRIPT,
        title: '结构方案',
        copyable: true,
        body:
          '"比如彩礼走全礼数，面子给足；其中约定一部分以嫁妆/小家庭启动金回流；' +
          '车房计入小家庭资产计划。两家都好看，钱也回到咱们手里。"',
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '对方说："我们那边就是这个价，没什么可谈的。"',
        options: [
          { key: 'A', text: '"行，那就按这个来。"（空间全失，还可能加码）', correct: false, explain: '' },
          {
            key: 'B',
            text:
              '"明白，行情我尊重。那咱们聊聊\'怎么给\'吧——流程和安排上，应该还有得商量？"',
            correct: true,
            explain: '解析：认行情=认诚意，是打开结构谈判的前提；B 把战场从数字挪到安排。',
          },
          { key: 'C', text: '"这也太贵了。"（谈判直接破裂）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 8,
        cardType: CARD_TYPE_ACTION,
        title: '今晚',
        body:
          '① 各自列：当地行情完整清单（含五金、车房口径）② 标出哪些是"死的"、哪些有弹性 ' +
          '③ 约好：长辈再问，统一回复"我们俩在商量方案"。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 02
  {
    code: TOPIC_CODES.MONEY,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '领证后才第一次看到对方的征信和负债。\n' +
          '💥 婚后炸的雷，婚前都是没问出口的问题。财务不透明不是信任问题，是流程问题——流程可以补，爆炸没法补。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body: '"谈钱伤感情。"\n💥 真相是：不谈钱才伤感情。回避谈钱的关系，最后都靠吵架来谈。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_SCRIPT,
        title: '婚前交底',
        copyable: true,
        body:
          '"我想咱俩在领证前互相交个底：收入、存款、负债、每月给父母的固定支持。' +
          '不是查岗，是避免婚后炸雷——我先说我的。"',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '共同账户',
        copyable: true,
        body:
          '"咱们建一个共同账户，每人每月按收入比例打一笔，家里开销全从里面出，' +
          '剩下的各自自由支配——各有的花，家也有的花。"',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '大额规则',
        copyable: true,
        body: '"定个规矩：单笔超过 X 元的大件消费，互相打个招呼。不是请示，是让彼此心里都有数。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '无意中发现对方有一笔没提过的消费贷。',
        options: [
          { key: 'A', text: '"你居然瞒着我借钱？！"（信任直接开战）', correct: false, explain: '' },
          {
            key: 'B',
            text: '"我看到了那笔贷款，咱一起捋捋：多少、利率、怎么还，要不要并到共同计划里。"',
            correct: true,
            explain: '解析：B 把"隐瞒"处理成"待解决的财务问题"，而不是"人格审判"。',
          },
          { key: 'C', text: '装不知道，等 TA 自己说。（攒雷）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 交换征信报告（人行官网可查）② 列出各自固定支出表 ③ 确定共同账户比例，先试跑三个月。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 03
  {
    code: TOPIC_CODES.CHORES,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '"谁看不下去谁干。"\n' +
          '💥 结局几乎固定：标准低的一方岁月静好，标准高的一方负重前行——直到某天为一只碗爆炸。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body: '说"帮你做点家务"。\n💥 "帮"这个字本身就是坑：默认了家务是某一方的主业。家是两个人的，活也是。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_SCRIPT,
        title: '清单分赃',
        copyable: true,
        body: '"把家里所有家务列成清单，一人挑一半，剩下的互相交换——这比\'自觉\'靠谱一百倍。"',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '标准对齐',
        copyable: true,
        body:
          '"你眼里的\'收拾好了\'和我眼里的可能差很远。先对齐标准再分活——' +
          '不然我们天天为同一件事吵架。"',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '动态调整',
        copyable: true,
        body: '"每月留一次 15 分钟\'家务例会\'：谁最近累、谁最近闲，临时换一换。别让怨气攒到爆发。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '对方说："我工作累，你就多干点呗。"',
        options: [
          { key: 'A', text: '"凭什么？！"（进入对错之争）', correct: false, explain: '' },
          {
            key: 'B',
            text: '"累是真的，那这周你少干的，换成你负责 XX 和那两件，下周看你状态再调——行不？"',
            correct: true,
            explain: '解析：B 承认事实 + 按周动态换岗，家务从"义务之争"变"排班问题"。',
          },
          { key: 'C', text: '默默多干，记在心里。（记账式怨气）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body:
          '① 列出全部家务清单（含隐形劳动：采买、记账、记亲戚生日）② 各自认领 + 交换 ' +
          '③ 手机上共享待办，完成打勾。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 04
  {
    code: TOPIC_CODES.SECOND_CHILD,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '一方私下答应了长辈"我们会要二胎的"。\n💥 替对方做了人生重大决定，比不要二胎本身伤关系一百倍。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body: '"你不想要就是不爱我/不为这个家想。"\n💥 立场之争一旦升级到情感审判，就没有赢家——只有两败俱伤。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_COGNITION,
        title: null,
        body:
          '"要不要二胎"其实是三道题：钱够不够、人手谁出、careers 谁让。' +
          '把一道立场题拆成三道算术题，才谈得下去。',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '留余地',
        copyable: true,
        body: '"我现在的想法是 X，但我承认想法会变——咱们先不定死，约个时间（比如半年后）再聊一次？"',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '算账',
        copyable: true,
        body: '"咱们一件一件算：账上每月结余、老人能不能带、谁的工作弹性大。算完再决定，谁也不用被说服。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_SCRIPT,
        title: '对被催生',
        copyable: true,
        body: '"妈，这事我们俩有规划，定了一定第一时间告诉您。"（两口子先统一口径，再各自挡各自家的长辈。）',
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '婆婆饭桌上催生，伴侣低头不表态。你：',
        options: [
          { key: 'A', text: '"我们还没想好。"（把分歧公开化）', correct: false, explain: '' },
          {
            key: 'B',
            text: '笑着岔开话题，回家对伴侣说："刚才那场面咱俩得先对个口径，下次你先来挡。"',
            correct: true,
            explain: '解析：先内部统一，再对外输出——顺序反了必炸。',
          },
          {
            key: 'C',
            text: '当场表态"我们肯定生"（or 不生）。（替两人做了主）',
            correct: false,
            explain: '',
          },
        ],
      },
      {
        orderNo: 8,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 各自写下要/不要的三个真实理由 ② 列出养娃成本粗账 ③ 约定"半年后再谈"的日历提醒。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 05
  {
    code: TOPIC_CODES.IN_LAW_BOUNDARY,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '"你妈又……"——把伴侣当成传话筒和裁判。\n' +
          '💥 TA 被夹在两个最爱的人中间，进退都是错。你把 TA 逼成裁判的那一刻，TA 只能判你输。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '当面忍、回家炸，伴侣成了唯一出气筒。\n' +
          '💥 长辈没收到任何信号，伴侣平白挨了所有子弹——最差的处理方式，没有之一。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_COGNITION,
        title: null,
        body:
          '立规矩的顺序永远是：小两口先统一 → 谁的父母谁去说。' +
          '子女对自己的父母有"豁免权"，媳妇/女婿说同样的话就是战争。',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '对伴侣',
        copyable: true,
        body:
          '"我跟你说咱妈那件事，是想和你一起想办法，不是让你选边站。' +
          '咱们先统一个口径，再由你去说。"',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '对长辈',
        copyable: true,
        body: '"妈，这事我们俩商量过了，打算这样办。您放心，有变化第一时间跟您说。"（态度软，立场硬。）',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_SCRIPT,
        title: '划界前置',
        copyable: true,
        body: '"咱俩先把规矩定好：哪些事父母可以提意见，哪些咱俩说了算。定好了，各自的父母各自去沟通。"',
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '婆婆没打招呼，说明天来小住半个月。',
        options: [
          { key: 'A', text: '忍了，回家对伴侣发火。', correct: false, explain: '' },
          {
            key: 'B',
            text:
              '立刻跟伴侣说："妈要来，咱俩先对个欢迎方案——住多久、怎么安排，然后你去跟妈确认。"',
            correct: true,
            explain: '解析：B 走"内部统一→原生家庭成员出面"的标准流程，三方体面。',
          },
          { key: 'C', text: '自己直接给婆婆打电话拒绝。（越级处理）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 8,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 列出"可商量/不可商量"清单 ② 约定：一方父母越界时，另一方 24 小时内由其本人去沟通。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 06
  {
    code: TOPIC_CODES.COLD_WAR,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '用沉默惩罚对方，等 TA 先低头。\n' +
          '💥 冷战是"你不按我的来，我就撤回爱"。短期赢了姿态，长期输了安全感。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body: '"你现在立刻给我说清楚！"\n💥 情绪顶点逼人谈判，只会得到防御和更大的火。先降火，再谈事。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_SCRIPT,
        title: '暂停规则',
        copyable: true,
        body: '"我们定个暗号：谁说\'暂停\'，另一方必须停——但暂停最长 24 小时，到点必须回来谈。"',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '破冰第一句',
        copyable: true,
        body: '"我不想赢这场架，我想和你是一伙的。我刚才也有不对的地方——XX。"（先给台阶，台阶不是认输。）',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '复盘',
        copyable: true,
        body: '"这次咱们只复盘一件事：下次遇到同样的情况，咱俩各自改哪一个动作？一人只改一个。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '冷战第三天，谁也没说话。',
        options: [
          { key: 'A', text: '继续等，看谁先扛不住。', correct: false, explain: '' },
          {
            key: 'B',
            text: '发出暂停暗号："我不是在赌气，我需要缓缓，今晚 8 点我们谈 15 分钟，好吗？"',
            correct: true,
            explain: '解析：B 给冷战装了一个"24 小时到期"的出口——暂停是技术，消失才是伤害。',
          },
          { key: 'C', text: '假装什么都没发生，直接聊晚饭。（雷埋在原地）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 一起定暂停暗号 ② 约定"到点必谈"的具体时间机制 ③ 各自写下自己最容易上头的触发词，互相通报。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 07
  {
    code: TOPIC_CODES.LONG_DISTANCE,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '"以后再说"——异地问题从恋爱拖到婚前，最后在装修/领证前爆炸。\n' +
          '💥 异地不是感情问题，是结构问题。结构问题越早摆上桌，代价越小。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '默认"谁收入高/谁是男的，谁留下"。\n' +
          '💥 按惯性而不是按机会成本做决定，输的那一方会用很多年怨气来付账。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_SCRIPT,
        title: '摆问题',
        copyable: true,
        body: '"把异地三件事写纸上：去谁的城市、各待多久、什么时候结束异地。今天不定答案，但问题必须摆全。"',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '机会成本',
        copyable: true,
        body: '"谁留下，不看性别不看收入——看谁的机会损失更小、谁的行业在另一座城市也能活。"',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '反悔机制',
        copyable: true,
        body:
          '"就算定了谁去谁留，也定个\'反悔条款\'：如果 X 个月后不适应，' +
          '允许重新谈判一次，不翻旧账。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '伴侣拿到异地城市的升职 offer，希望你去 TA 的城市。',
        options: [
          { key: 'A', text: '"为什么不是你为我回来？"（进入牺牲竞赛）', correct: false, explain: '' },
          {
            key: 'B',
            text: '"恭喜！这是大事，我们用两周把两边的账算清楚：工作、收入、生活成本，然后一起决定。"',
            correct: true,
            explain: '解析：先恭喜、再进入结构化评估——B 让"谁付出"变成"我们一起算"。',
          },
          { key: 'C', text: '当场答应/拒绝。（重大决定情绪化拍板）', correct: false, explain: '' },
        ],
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 列出双城各自的收入/成本/职业机会对照表 ② 设定结束异地的最晚期限 ③ 约好"反悔条款"的触发条件。',
      },
    ],
  },

  // ---------------------------------------------------------------- 议题 08
  {
    code: TOPIC_CODES.MEET_PARENTS,
    cards: [
      {
        orderNo: 1,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '把见家长当面试：过度表演勤快、抢话、猛刷存在感。\n' +
          '💥 长辈要的不是"能干的孩子"，是"让我孩子以后过得踏实的孩子"。用力过猛=心虚。',
      },
      {
        orderNo: 2,
        cardType: CARD_TYPE_PITFALL,
        title: null,
        body:
          '事前不做情报交换，踩了对方家里的忌讳（离婚话题、收入攀比、宗教饮食）当场社死。\n' +
          '💥 见家长 90% 的翻车，栽在"不知道"，而不是"做不到"。',
      },
      {
        orderNo: 3,
        cardType: CARD_TYPE_SCRIPT,
        title: '情报交换',
        copyable: true,
        body:
          '"去之前咱俩交底：你爸忌讳什么、你妈最看重什么、家里最近有什么烦心事——我好避雷。"',
      },
      {
        orderNo: 4,
        cardType: CARD_TYPE_SCRIPT,
        title: '敏感问题挡箭牌',
        copyable: true,
        body:
          '被问工资/买房/生娃："阿姨，这个我们正在规划呢，定下来第一个告诉您。"（微笑，不接具体数字。）',
      },
      {
        orderNo: 5,
        cardType: CARD_TYPE_SCRIPT,
        title: '表现原则',
        copyable: true,
        body:
          '"自然接话、少抢话，临走记得道谢——长辈要的是\'这孩子靠谱\'，不是\'这孩子能干\'。"',
      },
      {
        orderNo: 6,
        cardType: CARD_TYPE_QUIZ,
        title: null,
        body: '饭桌上长辈问："打算什么时候要孩子呀？"',
        options: [
          { key: 'A', text: '"我们计划三年内。"（把未定的事说死）', correct: false, explain: '' },
          {
            key: 'B',
            text: '"这个我们有自己的节奏，到时候一定先跟您报喜。"（笑着带过）',
            correct: true,
            explain:
              '解析：B 给了长辈"被重视"的感觉，又没承诺任何东西——挡箭牌的精髓是"给期待，不给信息"。',
          },
          {
            key: 'C',
            text: '"现在养孩子多贵啊，暂时没想过。"（价值观对线，饭局变辩论）',
            correct: false,
            explain: '',
          },
        ],
      },
      {
        orderNo: 7,
        cardType: CARD_TYPE_ACTION,
        title: null,
        body: '① 完成情报交换（忌讳 3 条+喜好 3 条）② 备一份得体的伴手礼 ③ 约定"被问倒时 TA 来解围"的暗号。',
      },
    ],
  },
];
