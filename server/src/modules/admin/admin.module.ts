import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { SysConfigEntity } from '../sys-config/entities/sys-config.entity.js';
import { TopicModule } from '../topic/topic.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminConfigController } from './admin-config.controller.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminCouponController } from './admin-coupon.controller.js';
import { AdminEntitlementController } from './admin-entitlement.controller.js';
import { AdminOrderController } from './admin-order.controller.js';
import { AdminPaymentService } from './admin-payment.service.js';
import { AdminProductController } from './admin-product.controller.js';
import { AdminSessionService } from './admin-session.service.js';
import { AdminTopicController } from './admin-topic.controller.js';
import { AdminUserEntity } from './entities/admin-user.entity.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { AdminIpGuard } from './guards/admin-ip.guard.js';

/**
 * 管理后台模块（模块 8，ADR-003）
 *
 * 本期范围（「站点域切片」，产品负责人 2026-09-19 裁决）：
 *   后台鉴权（账号密码 + TOTP + IP 白名单）+ 站点配置域读写 + 审计留痕
 * 模块 6 切片：商品 / 兑换码 / 订单（补单 + 退款）/ 权益（查询 + 补发）
 * 模块 7 切片：锦囊内容域（议题列表/编辑 + 卡片列表/新增/编辑）
 * 其余配置域（量表/计分/报告/运营/开关）待模块 3–7 产出的数据与服务齐备后补
 *
 * 守卫说明：本模块不注册 APP_GUARD —— 后台守卫必须按控制器显式挂载，
 *          避免「全局生效」导致小程序接口被误拦（两者鉴权体系完全独立）。
 * 注意：AdminUserEntity 需在此 forFeature 注册，AdminAuthGuard 才能注入其 Repository。
 *
 * 依赖说明：PaymentModule 导出 ProductService / EntitlementService / OrderService / CouponService，
 *          后台支付域切片复用它们（资金与权益的原子操作不重复实现），
 *          写操作与审计留痕则集中在本模块的 AdminPaymentService（后台身份不渗入 payment 域）。
 *          TopicModule 导出 TopicService，后台内容域切片复用其读写方法（同理，后台身份不渗入 topic 域）。
 *          AuditModule 提供 AuditLogService（该服务同时被 C 端内容域使用，故不再是本模块私有 provider）。
 *
 * ⚠️ 依赖方向：admin → {payment, topic} 单向。TopicModule 不得反过来 import AdminModule
 *    （否则形成循环依赖：topic 是 C 端内容域，后台只是它的一个消费方）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUserEntity, SysConfigEntity]),
    AuditModule,
    PaymentModule,
    TopicModule,
  ],
  controllers: [
    AdminAuthController,
    AdminConfigController,
    AdminProductController,
    AdminCouponController,
    AdminOrderController,
    AdminEntitlementController,
    AdminTopicController,
  ],
  providers: [
    AdminAuthService,
    AdminSessionService,
    AdminConfigService,
    AdminPaymentService,
    AdminContentService,
    AdminAuthGuard,
    AdminIpGuard,
  ],
})
export class AdminModule {}
