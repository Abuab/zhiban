import { SetMetadata } from '@nestjs/common';

export const ALLOW_TOTP_UNBOUND_KEY = 'allowTotpUnbound';

/**
 * 允许「尚未绑定二次验证」的后台令牌访问该接口（ADR-003 决策 4）
 *
 * 背景：管理员首次登录时 totp_secret 为空，此时若所有后台接口都拒绝，
 *      管理员将无法自助完成绑定（只能人工改库），属于自锁设计缺陷。
 * 用法：仅限 TOTP 绑定流程与「取本人资料 / 退出登录」这类低风险接口，
 *      **不得**用于任何配置读写接口。
 */
export const AllowTotpUnbound = () => SetMetadata(ALLOW_TOTP_UNBOUND_KEY, true);
