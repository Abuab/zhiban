import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_ANSWER_COUNT,
  MAX_DIMENSION_CODE_LENGTH,
  MAX_DURATION_SEC,
  MAX_QUESTION_CODE_LENGTH,
} from '../assessment.constants.js';

/**
 * 保存草稿 / 交卷的公共入参
 *
 * 说明：
 * - `answers` 只做「是对象」这一层校验，具体题号与取值由服务端按**锁定版本的题目定义**逐题净化
 *   （不可信输入不能只靠 DTO 校验，见 assessment.mapper.ts）；
 * - `draftVersion` 为乐观锁版本号（A3）：客户端须回传最近一次读到的值，不一致即拒绝，避免多端互相覆盖。
 */
export class SaveAnswersDto {
  @IsInt()
  @Min(0)
  draftVersion: number;

  /** 答案：{题号: 分值或选项键} */
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;

  /** 被拒绝授权的敏感维度编码（B7）；只允许敏感维度，其余编码服务端拒绝 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ANSWER_COUNT)
  @IsString({ each: true })
  @MaxLength(MAX_DIMENSION_CODE_LENGTH, { each: true })
  skippedDimensions?: string[];

  /**
   * 逐题拒绝作答的题号（ADR-013）
   * 白名单：题号须属于该卷锁定的量表版本，且该题所属维度 is_sensitive = 1；
   * 不得与 skippedDimensions 覆盖同一维度（两种产品动作互斥），违者服务端 `10001` 拒绝。
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ANSWER_COUNT)
  @IsString({ each: true })
  @MaxLength(MAX_QUESTION_CODE_LENGTH, { each: true })
  skippedQuestionCodes?: string[];
}

/** 交卷入参（在草稿入参基础上追加作答时长） */
export class SubmitAssessmentDto extends SaveAnswersDto {
  /**
   * 作答总时长（秒）：由客户端上报「实际作答时长」，不含中途退出后离开的时间。
   * 仅用于 B3/B4 的低质量标记，不影响分数；上限防止异常值污染报告提示。
   */
  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_SEC)
  durationSec: number;
}
