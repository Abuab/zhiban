import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记接口无需登录态（如健康检查、微信登录取码）
 * 注意：标记为 Public 不代表跳过限流，限流守卫仍然生效
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
