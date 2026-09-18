import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { AppLogger } from './common/logger/app-logger.service.js';
import { createRequestContextMiddleware } from './common/middlewares/request-context.middleware.js';

/**
 * 服务入口
 * 统一约定：全局前缀 /api；统一响应体；全局异常兜底；全局限流（AppModule 中的 APP_GUARD）
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;

  app.setGlobalPrefix('api');

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

  await app.listen(port, '0.0.0.0');
  logger.log(`服务已启动：http://127.0.0.1:${port}/api/health`, 'Bootstrap');
}

void bootstrap();
