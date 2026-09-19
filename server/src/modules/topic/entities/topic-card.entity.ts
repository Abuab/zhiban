import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 演练卡选项（CMS 数据格式见《锦囊卡片流 v1.0》§9.5） */
export interface TopicCardOption {
  /** A / B / C */
  key: string;
  /** 选项正文（不含解析） */
  text: string;
  /** 是否正确答案（每题恰好一个 true） */
  correct: boolean;
  /** 选中后展示的解析（选错也展示，帮助理解为何错） */
  explain: string;
}

/**
 * 锦囊卡片（表结构见 docs/schema.sql 第 291-306 行）
 *
 * 规格依据：《锦囊卡片流 v1.0》§9.5 CMS 数据格式；
 *   卡类型 pitfall / script / quiz / cognition / action（`exclusive` 由 exclusive_card 表承载）
 *
 * ⚠️ 正文按**纯文本**落库：规格原稿里的 `**` 强调标记不落库 ——
 *    话术卡支持「长按复制」，若正文含 markdown 标记，用户复制到聊天框会带上星号。
 */
@Entity('topic_card')
export class TopicCardEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  @Column({ name: 'topic_id', type: 'bigint', unsigned: true })
  topicId: number;

  /** 卡序（swiper 顺序） */
  @Column({ name: 'order_no', type: 'int', unsigned: true })
  orderNo: number;

  /** 卡类型（属性名避开 SQL 保留感较强的 type，列名仍为 `type`） */
  @Column({ name: 'type', type: 'varchar', length: 16 })
  cardType: string;

  /** 卡的副标题（如「对伴侣，摸底」），无则 null */
  @Column({ type: 'varchar', length: 256, nullable: true })
  title: string | null;

  /** 卡片正文（≤120 字） */
  @Column({ type: 'text' })
  body: string;

  /** 1 = 支持长按复制（话术卡） */
  @Column({ type: 'tinyint', default: 0 })
  copyable: number;

  /** 演练卡选项；非演练卡为 null */
  @Column({ name: 'options_json', type: 'json', nullable: true })
  optionsJson: TopicCardOption[] | null;

  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
