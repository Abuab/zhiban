import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { AnswerMap } from '../../../engines/scale/scale.types.js';
import type {
  AnswerSheetStatus,
  AssessmentScene,
  SheetScoresCache,
} from '../assessment.types.js';

/**
 * 答题卷（表结构见 docs/schema.sql 第 157-179 行）
 * 规格依据：
 *   - B1：草稿自动保存，回来续答（answers_json + answered_count）
 *   - B5：交卷后锁定不可改（status = submitted 后拒绝任何普通答案写入）
 *   - B6：允许重测，每次新起一行（历史行保留，不覆盖）
 *   - B7：敏感维度拒绝授权 → skipped_dimensions_json 记录，报告标注「未评估」
 *   - ADR-013：敏感维度内可「逐题拒绝作答」→ skipped_questions_json 记录，与维度级跳过互斥
 *   - B8：作答锁定量表版本（scale_version_id），题库改版不影响进行中的答题与历史报告
 *   - A3：draft_version 乐观锁，防同一微信多设备互相覆盖
 *   - ADR-004 决策 2 / 4：跳过维度须与「得 0 分」区分；补答只放开被跳过的维度
 * 索引：idx_user_scene(user_id, scene, status) —— 续答入口按此定位最新草稿
 */
@Entity('answer_sheet')
export class AnswerSheetEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: number;

  /** 作答用户（user.id） */
  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId: number;

  /** 作答锁定的量表版本（B8 快照锚点） */
  @Column({ name: 'scale_version_id', type: 'bigint', unsigned: true })
  scaleVersionId: number;

  /** 场景：single 单人测评 / p16 十六型 / invite 双人邀请 */
  @Column({ type: 'varchar', length: 16 })
  scene: AssessmentScene;

  /** scene=invite 时关联邀请（模块 5 使用，模块 4 恒为 null） */
  @Column({ name: 'invite_id', type: 'bigint', unsigned: true, nullable: true })
  inviteId: number | null;

  /** 答案：{题号: 分值或选项键}；仅保存通过校验的题号（未作答的题不占键） */
  @Column({ name: 'answers_json', type: 'json', nullable: true })
  answersJson: AnswerMap | null;

  /** 被拒绝授权而跳过的敏感维度编码数组（B7）；null 与空数组等价 */
  @Column({ name: 'skipped_dimensions_json', type: 'json', nullable: true })
  skippedDimensionsJson: string[] | null;

  /**
   * 逐题拒绝作答的题号数组（ADR-013；仅敏感维度，白名单由 assessment.mapper 按 is_sensitive 判定）
   * 与 skipped_dimensions_json 并列保留：报告需要区分「整维未授权」与「已授权但个别题未答」。
   */
  @Column({ name: 'skipped_questions_json', type: 'json', nullable: true })
  skippedQuestionsJson: string[] | null;

  /** 草稿版本号，每次有效写入 +1（A3 乐观锁） */
  @Column({ name: 'draft_version', type: 'int', unsigned: true, default: 0 })
  draftVersion: number;

  /** 已作答题数（断点续答 B1 的进度分子） */
  @Column({ name: 'answered_count', type: 'int', unsigned: true, default: 0 })
  answeredCount: number;

  /** 总作答时长（秒，由客户端上报的「实际作答时长」，不含中断） */
  @Column({ name: 'duration_sec', type: 'int', unsigned: true, nullable: true })
  durationSec: number | null;

  /** 作答质量标记：low 低质量（B3 时长过短 / B4 直线作答）；null 表示未判定或质量正常 */
  @Column({ name: 'quality_flag', type: 'varchar', length: 16, nullable: true })
  qualityFlag: string | null;

  /** 本卷维度分缓存（交卷时写入，报告读取时不再重算） */
  @Column({ name: 'dimension_scores_json', type: 'json', nullable: true })
  dimensionScoresJson: SheetScoresCache | null;

  /** draft 草稿 / submitted 已交卷（B5 锁定） */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: AnswerSheetStatus;

  /** 开始作答时间（进度与时长排查用） */
  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt: Date | null;

  /** 交卷时间；非空即代表答案已锁定（B5） */
  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
