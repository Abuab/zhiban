import { Global, Module } from '@nestjs/common';
import { WechatService } from './wechat.service.js';

/**
 * 微信开放接口网关模块
 * 声明为 @Global：账号（内容安全）、订阅消息（模块 5）等多处需要，避免重复 import
 */
@Global()
@Module({
  providers: [WechatService],
  exports: [WechatService],
})
export class WechatModule {}
