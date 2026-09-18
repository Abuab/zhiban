import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 微信登录入参（POST /auth/login） */
export class LoginDto {
  /** wx.login 返回的 code（5 分钟有效且一次性，无需缓存） */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code: string;
}
