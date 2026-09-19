import { VERSION_NEUTRAL } from '@nestjs/common';
import { PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminConfigController } from './admin-config.controller.js';
import { AdminCouponController } from './admin-coupon.controller.js';
import { AdminEntitlementController } from './admin-entitlement.controller.js';
import { AdminOrderController } from './admin-order.controller.js';
import { AdminProductController } from './admin-product.controller.js';
import { AdminTopicController } from './admin-topic.controller.js';

/**
 * 后台路由路径回归测试
 *
 * 为什么需要这个测试：
 *   服务端开启了 URI 版本化且 defaultVersion='1'（main.ts），**未显式声明版本**的控制器
 *   会被自动加上 /v1 前缀。若后台控制器漏写 VERSION_NEUTRAL，真实路径会从
 *   `/api/admin/**` 漂移成 `/api/v1/admin/**`——而 Nginx vhost、后台前端 base 路径
 *   与 docs/api.md §10/§11 都按 `/api/admin/**` 约定，结果是**整站后台静默 404**，
 *   且单元测试与构建都会通过（本缺陷就是这么漏过去的）。
 *   故用一条断言把「路径约定」钉死在测试里：改错了 CI 立刻红。
 */
describe('后台路由路径（ADR-003 决策 1：/api/admin/**）', () => {
  const cases = [
    { name: 'AdminAuthController', type: AdminAuthController, path: 'admin/auth' },
    { name: 'AdminConfigController', type: AdminConfigController, path: 'admin/configs' },
    { name: 'AdminProductController', type: AdminProductController, path: 'admin/products' },
    { name: 'AdminCouponController', type: AdminCouponController, path: 'admin/coupons' },
    { name: 'AdminOrderController', type: AdminOrderController, path: 'admin/orders' },
    { name: 'AdminEntitlementController', type: AdminEntitlementController, path: 'admin/entitlements' },
    { name: 'AdminTopicController', type: AdminTopicController, path: 'admin/topics' },
  ];

  it.each(cases)('$name 声明 VERSION_NEUTRAL，不被 defaultVersion 加上 /v1', ({ type }) => {
    expect(Reflect.getMetadata(VERSION_METADATA, type)).toBe(VERSION_NEUTRAL);
  });

  it.each(cases)('$name 的控制器路径为 $path', ({ type, path }) => {
    expect(Reflect.getMetadata(PATH_METADATA, type)).toBe(path);
  });
});
