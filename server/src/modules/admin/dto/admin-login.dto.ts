import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 后台登录入参（POST /api/admin/auth/login） */
export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  /** 口令长度下限仅做基本防呆；真实强度由创建脚本约束 */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  /** 动态码：已绑定二次验证时必填（6 位数字） */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: '动态码必须是 6 位数字' })
  totpCode?: string;
}
