/**
 * 议题与卡片种子导入脚本（模块 7：锦囊卡片流）
 *
 * 为什么用脚本而不是 SQL 种子：8 议题卡片正文属「业务内容」，写成 TS 常量可被单测核对
 *   （如每个议题至少一张坑卡、演练卡必须有且仅有一个正确选项），再经服务层写入获得幂等与事务保证。
 *
 * 用法（需在 server 目录下执行，且已 npm run build）：
 *   npm run topic:seed              # 幂等导入：议题/卡片已存在则跳过（不动运营改过的文案）
 *   npm run topic:seed -- --force   # 覆盖已存在行（标题/正文/选项回到种子值）
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { TOPIC_SEEDS } from '../modules/topic/data/topic-seed.data.js';
import { TopicSeedService } from '../modules/topic/topic-seed.service.js';

interface ScriptOptions {
  force: boolean;
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：npm run topic:seed [-- --force]',
      '',
      '  --force  覆盖已存在的议题与卡片（标题/正文/选项回到种子值），默认幂等跳过',
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
    const seedService = app.get(TopicSeedService);
    const result = await seedService.seed(TOPIC_SEEDS, { force: options.force });
    const cardTotal = TOPIC_SEEDS.reduce((sum, seed) => sum + seed.cards.length, 0);
    process.stdout.write(
      `议题种子导入完成：议题 新增 ${result.topicsCreated} / 覆盖 ${result.topicsUpdated} / 跳过 ${result.topicsSkipped}；` +
        `卡片 新增 ${result.cardsCreated} / 覆盖 ${result.cardsUpdated} / 跳过 ${result.cardsSkipped}` +
        `（清单共 ${TOPIC_SEEDS.length} 个议题 / ${cardTotal} 张卡片）\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
