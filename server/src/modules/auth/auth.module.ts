import { Global, Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ProtectedController } from './protected.controller.js';
import { SessionService } from './session.service.js';

/**
 * 登录与会话模块（模块 2）
 * 声明为 @Global：SessionService 需被基础设施层的 AuthGuard（在根模块中注册）复用
 */
@Global()
@Module({
  imports: [AccountModule],
  controllers: [AuthController, ProtectedController],
  providers: [AuthService, SessionService],
  exports: [SessionService],
})
export class AuthModule {}
