import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** 完成二次验证绑定入参（POST /api/admin/auth/totp/enable） */
export class EnableTotpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: '动态码必须是 6 位数字' })
  code: string;
}
