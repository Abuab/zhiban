import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_ANSWER_COUNT } from '../../assessment/assessment.constants.js';

/** 量表编码在 scale.code 中为 VARCHAR(32) */
const MAX_SCALE_CODE_LENGTH = 32;

/** 共识项题号在 scale_question.code 中为 VARCHAR(16)（如 Q3 / P12） */
const MAX_QUESTION_CODE_LENGTH = 16;

/**
 * 邀请域入参（模块 5）
 *
 * 设计取舍：草稿保存 / 交卷**直接复用**测评域的 `SaveAnswersDto` / `SubmitAssessmentDto`
 * （见 assessment/dto/save-answers.dto.ts）—— 两条路径共用同一套净化和乐观锁实现，
 * 若在此另建一套 DTO，双人流程的约束就可能比单人宽松（不可接受，涉及双方数据）。
 */
export class CreateInviteDto {
  /**
   * 目标量表编码；不传则取婚前准备评估（SCALE-PRE）
   * 保留该字段是为了 P2 引入第二套双人量表时无需改接口契约。
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCALE_CODE_LENGTH)
  scaleCode?: string;
}

/** 知情同意（R8）：agreed=false 即拒绝同意 → declined（可换人重邀 1 次，C7） */
export class InviteConsentDto {
  @IsBoolean()
  agreed: boolean;
}

/**
 * L3 分享版长图素材入参（架构 §3.2 `POST /reports/:id/share-image {selected_blocks[]}`）
 *
 * `selectedBlocks` 的语义在 P1 实现为**共识项题号**（`consensus_json[].questionCode`）：
 * L3 的三个区块（标题/共识区/结尾）是模板固定的，可勾选的内容只有共识区条目本身。
 * 不传 = 默认仅共识区全量（PRD-002 R3「默认仅共识区」）。
 */
export class ShareMaterialDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ANSWER_COUNT)
  @IsString({ each: true })
  @MaxLength(MAX_QUESTION_CODE_LENGTH, { each: true })
  selectedBlocks?: string[];
}
