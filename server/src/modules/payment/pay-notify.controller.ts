import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBody,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { OrderService } from './order.service.js';
import { WXPAY_FAIL_BODY, WXPAY_SUCCESS_BODY } from './payment.constants.js';

/**
 * 支付结果回调（模块 6，接口契约见 docs/api.md §14）
 * 实际路径：`POST /api/v1/pay/notify`（配置项 `WXPAY_NOTIFY_URL` 须填本地址）
 *
 * 为什么只有一个回调入口（不为 mock 单开一个）：网关由 `PAYMENT_GATEWAY` 决定，
 *   回调处理链路（验签 → 留证 → 幂等 → 入账）**只有一套**；多开一个入口等于多一条
 *   可能被绕过验签的路径。mock 演练时向同一地址发带 mock 签名的报文即可。
 *
 * @Public()：微信服务器不带我们的登录态；回调的**身份凭据是签名**而不是 token。
 *   因此本接口的防伪完全依赖 `PaymentGateway.parseNotify` 的验签，
 *   未通过验签的报文只会落 `payment_notify_log(verify_result = 0)`，不入账。
 *
 * 限流按 IP：防有人拿伪造报文刷爆 `payment_notify_log`（写库成本 + 磁盘）。
 *
 * ⚠️ 响应体必须是**裸 JSON**（`{"code":"SUCCESS"}`），不能套统一响应体 ——
 *   微信只认这个格式；故此处用 `@Res()` 直接写响应，跳过全局响应包装拦截器。
 */
@Controller('pay')
export class PayNotifyController {
  constructor(
    private readonly orderService: OrderService,
    private readonly logger: AppLogger,
  ) {}

  @Post('notify')
  @Public()
  @RateLimit({ by: 'ip' })
  @HttpCode(HttpStatus.OK)
  async notify(
    @Headers() headers: Record<string, string | undefined>,
    @RawBody() rawBody: Buffer | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // 原始字节 → UTF-8：验签必须用原文，重新 JSON.stringify 会改变键序/转义从而验签必然失败
    const body = rawBody ? rawBody.toString('utf8') : '';

    if (!body) {
      this.logger.warn('支付回调缺少请求体（已在 payment_notify_log 之外丢弃）', 'PayNotifyController');
      res.type('application/json').send(WXPAY_FAIL_BODY);
      return;
    }

    let success = false;
    try {
      success = await this.orderService.handleNotify(headers, body);
    } catch (error) {
      // handleNotify 内部已尽力留证；此处兜底只为「无论如何都回一个明确的应答」，
      // 让微信按重推策略再投一次，而不是收到 5xx 后按未知错误处理。
      this.logger.error(
        `支付回调处理异常：${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
        'PayNotifyController',
      );
    }

    res.type('application/json').send(success ? WXPAY_SUCCESS_BODY : WXPAY_FAIL_BODY);
  }
}
