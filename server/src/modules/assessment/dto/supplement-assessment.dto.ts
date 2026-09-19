import { IsObject } from 'class-validator';

/**
 * 补答被跳过的敏感维度入参（A-4）
 *
 * 只接受 `skipped_dimensions_json` 中被跳过维度的题号，其余题号（含已锁定答案）一律丢弃：
 * B5 要求「提交后锁定不可改」，补答是唯一例外，且例外范围严格限定在「当时被拒绝授权、
 * 根本没作答的维度」——两者对象不同，不构成冲突（见 ADR-004 决策 4）。
 */
export class SupplementAssessmentDto {
  /** 答案：{题号: 分值或选项键}，须补齐被跳过维度的全部题目 */
  @IsObject()
  answers: Record<string, unknown>;
}
