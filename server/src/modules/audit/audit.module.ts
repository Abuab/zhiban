import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';

/**
 * 审计基础设施模块
 *
 * 为什么独立成模块而不是留在 AdminModule（原本在 admin 目录下）：
 *   `audit_log` 的写入方**跨后台与 C 端两域** —— 后台写配置/商品/越权尝试，
 *   C 端写「专属卡生成」（§9.3 要求记录 viewer / 时间 / prompt 版本）。
 *   若两种写入方共用 AdminModule 的 provider，则 TopicModule 必须 import AdminModule，
 *   而模块 8 的内容域后台切片又需要 AdminModule import TopicModule → **循环依赖**。
 *   抽取为独立模块后依赖方向变为 topic → audit ← admin，两边都是单向。
 *
 * 说明：本模块只提供写入能力，不提供查询接口（审计只增不改不删，查询后台在模块 8 另行切片）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
