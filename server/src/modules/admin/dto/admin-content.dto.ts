import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TOPIC_CARD_BODY_MAX_LENGTH, TOPIC_CARD_MAX_ORDER_NO, TOPIC_STATUS_OFF, TOPIC_STATUS_ON } from '../../topic/topic.constants.js';
import { AdminPageQueryDto } from './admin-payment.dto.js';

/**
 * 后台内容域入参（模块 7 后台切片，接口契约见 docs/api.md §16）
 *
 * 规格依据：《配置项注册表》内容域「锦囊（议题、正文、挂载维度）」—— 运营改文案、下架锦囊
 *   均无需发版（宪法 P5、G1 验收）；增补 v0.3 一「每张卡 ≤120 字」。
 *
 * 校验分层：结构与长度（类型 / 长度上界 / 枚举）在本文件 —— 长度上界必须与
 *   `topic.constants.ts` 同一个常量，避免「DTO 放行、库或端上另有一套上限」；
 *   语义合法性（挂载维度必须是真实维度、演练卡恰有一个正确答案、可复制只能是话术卡等）
 *   在 `AdminContentService`：它要读常量与既有数据，且需要给出中文可自纠的错误文案。
 */

/** 议题列表查询（GET /api/admin/topics） */
export class QueryAdminTopicDto extends AdminPageQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([TOPIC_STATUS_ON, TOPIC_STATUS_OFF])
  status?: string;

  /** 按编码或标题模糊搜索 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

/**
 * 编辑议题（PUT /api/admin/topics/:code）
 *
 * 说明：**不接收 `code`**。议题编码是权益与报告入口的语义锚点（`topic_single:<code>` 商品、
 *   `mount_dimensions` 反查、端上路径参数），改码会让已发放权益指向空商品。
 */
export class UpdateTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  /** 传空字符串表示清空副标题 */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  subtitle?: string;

  /** 挂载维度编码数组（服务层校验必须是真实维度编码；传空数组表示不挂任何维度） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  mountDimensions?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  orderNo?: number;

  @IsOptional()
  @IsString()
  @IsIn([TOPIC_STATUS_ON, TOPIC_STATUS_OFF])
  status?: string;
}

/** 新增卡片（POST /api/admin/topics/:code/cards）—— 卡序由服务端追加到末尾 */
export class CreateTopicCardDto {
  @IsString()
  @MaxLength(16)
  type: string;

  @IsString()
  @MaxLength(TOPIC_CARD_BODY_MAX_LENGTH)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @IsOptional()
  @IsBoolean()
  copyable?: boolean;

  /** 演练卡选项，结构由服务层严格校验（未知结构直接拒绝，不静默丢弃） */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  options?: unknown[];
}

/** 编辑卡片（PUT /api/admin/topics/:code/cards/:orderNo） */
export class UpdateTopicCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(TOPIC_CARD_BODY_MAX_LENGTH)
  body?: string;

  /** 传空字符串表示清空副标题 */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @IsOptional()
  @IsBoolean()
  copyable?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  options?: unknown[];

  /** 上下架（不提供物理删除：历史会话与阅读进度都按卡序引用） */
  @IsOptional()
  @IsString()
  @IsIn([TOPIC_STATUS_ON, TOPIC_STATUS_OFF])
  status?: string;

  /** 调整卡序（服务层校验同议题内不重复） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TOPIC_CARD_MAX_ORDER_NO)
  orderNo?: number;
}
