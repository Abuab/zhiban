import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysConfigEntity } from './entities/sys-config.entity.js';
import { SysConfigController } from './sys-config.controller.js';
import { SysConfigService } from './sys-config.service.js';

/**
 * 站点配置域（ADR-002）
 * 本模块（配置中心）先落地「公开配置只读接口」；写入与管理界面随模块 8 管理后台接入
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysConfigEntity])],
  controllers: [SysConfigController],
  providers: [SysConfigService],
  exports: [SysConfigService],
})
export class SysConfigModule {}
