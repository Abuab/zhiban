import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { PaymentConfig } from '../../config/configuration.js';
import { UserEntity } from '../account/entities/user.entity.js';
import { CouponService } from './coupon.service.js';
import { EntitlementService } from './entitlement.service.js';
import { CouponEntity } from './entities/coupon.entity.js';
import { EntitlementEntity } from './entities/entitlement.entity.js';
import { OrderEntity } from './entities/order.entity.js';
import { PaymentNotifyLogEntity } from './entities/payment-notify-log.entity.js';
import { ProductEntity } from './entities/product.entity.js';
import { FreeGatewayService } from './gateways/free-gateway.service.js';
import { MockGatewayService } from './gateways/mock-gateway.service.js';
import { PAYMENT_GATEWAY } from './gateways/payment-gateway.interface.js';
import type { PaymentGateway } from './gateways/payment-gateway.interface.js';
import { WechatGatewayService } from './gateways/wechat-gateway.service.js';
import { OrderExpireProcessor } from './order-expire.processor.js';
import { OrderExpireScheduler } from './order-expire.scheduler.js';
import { OrderService } from './order.service.js';
import { OrderController, PaymentCatalogController } from './payment.controller.js';
import { PayCheckProcessor } from './pay-check.processor.js';
import { PayCheckScheduler } from './pay-check.scheduler.js';
import { PayNotifyController } from './pay-notify.controller.js';
import { ORDER_EXPIRE_QUEUE, PAY_CHECK_QUEUE } from './payment.constants.js';
import { ProductSeedService } from './product-seed.service.js';
import { ProductService } from './product.service.js';

/**
 * 支付与权益域模块（模块 6，ADR-007）
 *
 * 职责：
 *   - 商品（后台可配价格/权益/iOS 可见性，E4 金额唯一真源）
 *   - 权益（`GET /entitlements` 是端上解锁态的唯一判定来源，PRD-005 §1）
 *   - 订单与回调（幂等 E2、金额比对 E4、快照 E6、超时关闭 E3、查单补单 E1）
 *   - 兑换码（一次性 + 7 天 E8）
 *   - 定时任务：超时关单（10 分钟）、每日对账（03:10）
 *
 * **网关选择**（ADR-007 决策 1）：三个实现类都被实例化，由工厂按 `PAYMENT_GATEWAY`
 *   挑一个绑定到 `PAYMENT_GATEWAY` 令牌；业务代码只注入接口，不感知具体实现。
 *   这样切网关只改 `.env` 一行，订单/权益/幂等链路完全复用（P1 免费 → P2 收费零代码改动）。
 *
 * 队列说明：QueueModule 已在根模块注册（@Global），此处只声明本域队列；
 *   消费者（@Processor）跟着业务域走，与模块 5 的 invite 域保持一致。
 *
 * 依赖方向：payment → account（下单需 openid 给 JSAPI）；admin 域反向依赖本模块做后台切片。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      OrderEntity,
      EntitlementEntity,
      CouponEntity,
      PaymentNotifyLogEntity,
      UserEntity,
    ]),
    BullModule.registerQueue({ name: ORDER_EXPIRE_QUEUE }, { name: PAY_CHECK_QUEUE }),
  ],
  controllers: [PaymentCatalogController, OrderController, PayNotifyController],
  providers: [
    ProductService,
    EntitlementService,
    OrderService,
    CouponService,
    FreeGatewayService,
    MockGatewayService,
    WechatGatewayService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [
        ConfigService,
        FreeGatewayService,
        MockGatewayService,
        WechatGatewayService,
        AppLogger,
      ],
      useFactory: (
        configService: ConfigService,
        free: FreeGatewayService,
        mock: MockGatewayService,
        wechat: WechatGatewayService,
        logger: AppLogger,
      ): PaymentGateway => {
        const { gateway } = configService.get<PaymentConfig>('payment') as PaymentConfig;
        logger.log(`支付网关已装载：${gateway}`, 'PaymentModule');
        if (gateway === 'mock') return mock;
        if (gateway === 'wechat') return wechat;
        return free;
      },
    },
    OrderExpireScheduler,
    OrderExpireProcessor,
    PayCheckScheduler,
    PayCheckProcessor,
    // 仅供 `npm run product:seed` 脚本通过 Nest 容器取用（与报告模板种子同构）
    ProductSeedService,
  ],
  // 供 admin 域做后台切片、topic 域做权益判定复用
  exports: [ProductService, EntitlementService, OrderService, CouponService],
})
export class PaymentModule {}
