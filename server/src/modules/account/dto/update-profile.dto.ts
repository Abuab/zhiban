import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 更新用户资料（PUT /auth/profile）
 * 说明：昵称/头像/隐私同意/年龄确认合并在同一接口，减少小程序端请求数；
 *      未传的字段一律不改（undefined 语义），传空字符串视为清空昵称
 */
export class UpdateProfileDto {
  /** 昵称：长度 2-20 字符（按 Unicode 码点计数），具体校验在 AccountService（需与内容安全联动） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nickname?: string;

  /** 头像地址：只接受 https（微信小程序要求安全域名，同时避免混合内容告警） */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^https:\/\/[^\s]+$/, { message: '头像地址必须是 https 链接' })
  avatarUrl?: string;

  /** 同意隐私政策（隐私约束 2.4：不同意仅可浏览首页） */
  @IsOptional()
  @IsBoolean()
  privacyAgreed?: boolean;

  /** 用户看到的隐私政策版本号，缺省时服务端记为当前版本 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  privacyPolicyVersion?: string;

  /** 确认已满 18 周岁 */
  @IsOptional()
  @IsBoolean()
  ageConfirmed?: boolean;
}
