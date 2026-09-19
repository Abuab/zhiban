/**
 * 商品种子导入脚本（模块 6：支付与权益）
 *
 * 为什么用脚本而不是 SQL 种子：与题库/报告模板同理 —— 商品清单属「业务数据」，
 *   写成 TS 常量可被单测核对（如 P1 必须 price = 0、每个议题都有对应商品），
 *   再经服务层写入获得幂等与事务保证。
 *
 * 用法（需在 server 目录下执行，且已 npm run build）：
 *   npm run product:seed              # 幂等导入：商品已存在则整行跳过（不动运营改过的价格）
 *   npm run product:seed -- --force   # 覆盖已存在商品（价格/名称/权益回到种子值）
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PRODUCT_SEEDS } from '../modules/payment/data/product-seed.data.js';
import { ProductSeedService } from '../modules/payment/product-seed.service.js';

interface ScriptOptions {
  force: boolean;
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：npm run product:seed [-- --force]',
      '',
      '  --force  覆盖已存在的商品（价格/名称/权益回到种子值），默认幂等跳过',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ScriptOptions {
  let force = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return { force };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // 复用应用配置与数据库连接，避免脚本自行解析 .env 造成配置口径分裂
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const seedService = app.get(ProductSeedService);
    const result = await seedService.seed(PRODUCT_SEEDS, { force: options.force });
    process.stdout.write(
      `商品种子导入完成：新增 ${result.created} / 覆盖 ${result.updated} / 跳过 ${result.skipped}` +
        `（清单共 ${PRODUCT_SEEDS.length} 个商品）\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
