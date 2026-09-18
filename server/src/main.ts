import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { AppLogger } from './common/logger/app-logger.service.js';
import { createRequestContextMiddleware } from './common/middlewares/request-context.middleware.js';

/**
 * 服务入口
 * 统一约定：全局前缀 /api + URI 版本 v1（业务接口为 /api/v1/xxx）；
 *          健康检查标记为 VERSION_NEUTRAL，保持 /api/health 不变（部署脚本与容器探针已依赖该路径）
 *          统一响应体；全局异常兜底；全局限流（AppModule 中的 APP_GUARD）
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  // 默认只监听本机：外部流量统一经 Nginx 反代进入，避免业务端口被直连绕过反代
  const host = config.get<string>('app.host') ?? '127.0.0.1';

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 在 express 层全局挂载：早于路由/守卫，404 与鉴权失败也带 traceId
  app.use(createRequestContextMiddleware(logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`服务已启动：http://${host}:${port}/api/health`, 'Bootstrap');
}

void bootstrap();
