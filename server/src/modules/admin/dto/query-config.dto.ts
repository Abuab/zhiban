import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 站点配置列表查询（GET /api/admin/configs） */
export class QueryConfigDto {
  /** 分组筛选（brand / site / contact …），不传则返回全部分组 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  group?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * 站点配置编辑（PATCH /api/admin/configs/:configKey）
 * 只允许改「值 / 是否公开 / 说明」三项，键名与分组不可改（ADR-003 决策 6）
 */
export class UpdateConfigDto {
  /** 配置值（字符串形态，按 valueType 校验合法性） */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  configValue?: string;

  /** 是否可经免鉴权接口下发：1 公开 / 0 仅后台可见 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: 'isPublic 只能是 0 或 1' })
  isPublic?: number;

  /** 配置说明（后台表单提示文案） */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;
}
