import { IsIn } from 'class-validator';
import type { StartableScene } from '../assessment.types.js';

/**
 * 可发起作答的场景（评测域开放范围，fail-closed：不在白名单的场景一律拒绝）
 * - single：婚前关系准备评估（SCALE-PRE，76 题，含敏感维度前置同意与底线题组）
 * - p16：16 型人格图谱（SCALE-16P，24 题二选一）
 * invite（双人邀请）由模块 5 通过邀请流程创建，不对外开放
 */
export const STARTABLE_SCENES: readonly StartableScene[] = ['single', 'p16'];

/** 开始（或续答）一次单人测评 */
export class StartAssessmentDto {
  @IsIn(STARTABLE_SCENES)
  scene: StartableScene;
}

/** 续答入口查询（GET current?scene=single） */
export class CurrentAssessmentQueryDto {
  @IsIn(STARTABLE_SCENES)
  scene: StartableScene;
}
