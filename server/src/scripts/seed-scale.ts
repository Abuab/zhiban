/**
 * 题库种子导入脚本（模块 3：量表引擎）
 *
 * 为什么用脚本而不是 SQL 种子：
 *   题库是「规格内容数据」，必须与 docs/constitution.md 逐题一致。写成 TS 常量后
 *   可用类型系统约束结构、可被单元测试核对题数与标记（模块 3 完成标准），
 *   再经服务层写入可获得幂等判定与事务保证。
 *
 * 用法（需在 server 目录下执行，且已 npm run build；.env 的 DB_* 必须可连）：
 *   npm run scale:seed              # 幂等导入：版本已存在则整段跳过，不产生任何写入
 *   npm run scale:seed -- --force   # 重建已存在版本（先删本版本的维度与题目，再重建）
 *
 * ⚠️ --force 的风险：该版本若已被进行中的邀请锁定（B8 版本快照），重建题目会让
 *    已发起的邀请与题库不一致。服务会打 warn 日志留痕。线上迭代应新增版本号，
 *    而不是重建既有版本。
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ScaleVersionSeed } from '../engines/scale/scale.types.js';
import { AppModule } from '../app.module.js';
import { SCALE_16P_1_0 } from '../modules/scale/data/scale-16p-1.0.data.js';
import { SCALE_PRE_1_0 } from '../modules/scale/data/scale-pre-1.0.data.js';
import { ScaleEntity } from '../modules/scale/entities/scale.entity.js';
import { ScaleVersionEntity } from '../modules/scale/entities/scale-version.entity.js';
import { ScaleSeedService } from '../modules/scale/scale-seed.service.js';

/**
 * 导入清单：
 * - SCALE-PRE 婚前关系准备评估（76 题，阶段 0 裁决 D-3）
 * - SCALE-16P 16 型人格图谱（24 题，阶段 0 裁决 D-4 纳入 P1）
 */
const SEEDS: ScaleVersionSeed[] = [SCALE_PRE_1_0, SCALE_16P_1_0];

/** 仅婚前评估需要计分规则：16 型以四维端点组合出类型，不产出 0-100 维度分 */
const SCALE_CODES_NEED_SCORING_RULE = [SCALE_PRE_1_0.scaleCode];

interface ScriptOptions {
  force: boolean;
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：npm run scale:seed [-- --force]',
      '',
      '  --force  重建已存在的版本（先删本版本的维度与题目再重建，会打 warn 日志）',
      '           默认幂等：版本已存在时整段跳过，不产生任何写入',
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
    const seedService = app.get(ScaleSeedService);
    const scaleRepository = app.get<Repository<ScaleEntity>>(getRepositoryToken(ScaleEntity));
    const versionRepository = app.get<Repository<ScaleVersionEntity>>(
      getRepositoryToken(ScaleVersionEntity),
    );

    for (const seed of SEEDS) {
      const result = await seedService.seedVersion(seed, { force: options.force });
      const action = result.skipped ? '已存在，跳过' : '导入完成';
      process.stdout.write(
        `${seed.scaleCode} ${seed.version} ${action}：题目 ${result.questionCount} 道\n`,
      );
    }

    for (const scaleCode of SCALE_CODES_NEED_SCORING_RULE) {
      const scale = await scaleRepository.findOne({ where: { code: scaleCode } });
      if (!scale) throw new Error(`未找到量表 ${scaleCode}，计分规则未写入`);
      const version = await versionRepository.findOne({
        where: { scaleId: scale.id, version: SCALE_PRE_1_0.version },
      });
      if (!version) throw new Error(`未找到量表 ${scaleCode} 的版本行，计分规则未写入`);

      await seedService.ensureDefaultScoringRule(version.id);
      process.stdout.write(
        `${scaleCode} 计分规则已就绪（version_id=${version.id}，已存在的规则不会被覆盖）\n`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
