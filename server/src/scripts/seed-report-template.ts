/**
 * 报告模板种子导入脚本（模块 4：单人测评与简版报告）
 *
 * 为什么用脚本而不是 SQL 种子：与题库同理 —— 报告文案属「规格内容数据」，
 *   写成 TS 常量可被单测核对（如点评字数上限、禁词），再经服务层写入获得幂等与事务保证。
 *
 * 用法（需在 server 目录下执行，且已 npm run build）：
 *   npm run report:seed              # 幂等导入：模板已存在则整段跳过
 *   npm run report:seed -- --force   # 重建已存在模板（先删本模板的区块再重建）
 *
 * 前置：必须先执行 npm run scale:seed（模板要挂到 scale_version_id 上）
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { SINGLE_16P_TEMPLATE } from '../modules/report/data/single-16p-template.data.js';
import { SINGLE_PRE_LITE_TEMPLATE } from '../modules/report/data/single-lite-template.data.js';
import type { ReportTemplateSeed } from '../modules/report/report-seed.types.js';
import { ReportTemplateSeedService } from '../modules/report/report-template-seed.service.js';

/** 导入清单（模块 5 会追加双人对比报告模板） */
const SEEDS: ReportTemplateSeed[] = [SINGLE_PRE_LITE_TEMPLATE, SINGLE_16P_TEMPLATE];

interface ScriptOptions {
  force: boolean;
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：npm run report:seed [-- --force]',
      '',
      '  --force  重建已存在的模板（先删本模板区块再重建），默认幂等跳过',
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
    const seedService = app.get(ReportTemplateSeedService);

    for (const seed of SEEDS) {
      const result = await seedService.seedTemplate(seed, { force: options.force });
      const action = result.skipped ? '已存在，跳过' : '导入完成';
      process.stdout.write(`${seed.code} ${seed.version} ${action}：区块 ${result.blockCount} 个\n`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
