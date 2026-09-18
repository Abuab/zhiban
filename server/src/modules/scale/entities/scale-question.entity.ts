import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { QuestionOption, QuestionType } from '../../../engines/scale/scale.types.js';

/**
 * scale_question.ext_json 的内容：考察点等扩展字段
 * 规格依据：题库表格最后一列「考察点」仅作运营参考，不参与计分
 */
export interface ScaleQuestionExtJson {
  note?: string;
}

/**
 * 量表题目（表结构见 docs/schema.sql 第 129-149 行）
 * 规格依据：
 *   - 规则 1：量表题反向计分（reverse = 1 时 6 - 原值）
 *   - 规则 2：Q27 为风格题，不计入维度分（is_style = 1）
 *   - 规则 6：Q72-Q76 为底线题组，独立呈现、不参与维度分（is_baseline = 1）
 *   - G1：题目级开关 status，下架题目保留行（历史答案快照仍可解释）
 * 唯一键：uk_version_code(scale_version_id, code)
 */
@Entity('scale_question')
export class ScaleQuestionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 所属版本（scale_version.id） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 所属维度；底线题组可为空（独立呈现） */
  @Column({ name: 'dimension_id', type: 'bigint', unsigned: true, nullable: true })
  dimensionId: number | null;

  /** 题号，如 Q1 / P1 */
  @Column({ type: 'varchar', length: 16 })
  code: string;

  /** 卷内顺序（答题进度以此排序） */
  @Column({ name: 'order_no', type: 'int', unsigned: true })
  orderNo: number;

  /** 题型：scale 量表 / choice 选择 / binary A-B 二选一 */
  @Column({ type: 'varchar', length: 16 })
  type: QuestionType;

  /** 题干 */
  @Column({ type: 'varchar', length: 512 })
  title: string;

  /** 反向题（6 - 原值）：1 是 / 0 否 */
  @Column({ type: 'tinyint', default: 0 })
  reverse: number;

  /** 风格题（不计入维度分，Q27）：1 是 / 0 否 */
  @Column({ name: 'is_style', type: 'tinyint', default: 0 })
  isStyle: number;

  /** 底线题组（R5 / B9）：1 是 / 0 否 */
  @Column({ name: 'is_baseline', type: 'tinyint', default: 0 })
  isBaseline: number;

  /** 选择题选项；二选一存 A/B 端点文案；量表题为 null（固定 1-5） */
  @Column({ name: 'options_json', type: 'json', nullable: true })
  optionsJson: QuestionOption[] | null;

  /** 考察点等扩展字段（当前承载 ScaleQuestionExtJson.note） */
  @Column({ name: 'ext_json', type: 'json', nullable: true })
  extJson: ScaleQuestionExtJson | null;

  /** 题目状态：on 上架 / off 下架（题目级开关 G1） */
  @Column({ type: 'varchar', length: 16, default: 'on' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
