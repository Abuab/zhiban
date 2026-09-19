import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TOPIC_CARD_MAX_ORDER_NO } from '../topic.constants.js';

/**
 * 内容域入参（模块 7）
 *
 * 依据：《锦囊卡片流 v1.0》§9.4「已读进度本地记录，可续看」→ 服务端记录（ADR-007 附带决策 3）。
 */

/** 阅读进度上报（PUT /api/v1/topics/:code/progress） */
export class SaveTopicProgressDto {
  /** 当前停留的卡序（0 起；端上滑到第 N 张卡时上报 N） */
  @IsInt()
  @Min(0)
  @Max(TOPIC_CARD_MAX_ORDER_NO)
  lastOrderNo: number;

  /** 是否已「学会」打卡；不传视为不改变既有状态（端上可能只上报滑动位置） */
  @IsOptional()
  @IsBoolean()
  finished?: boolean;
}
