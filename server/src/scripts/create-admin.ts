/**
 * 后台管理员账号创建 / 重置脚本（ADR-003 决策 4）
 *
 * 为什么用脚本而不是 SQL 种子：
 *   种子 SQL 要么写明文口令（违反安全基线 §4），要么写固定哈希（等于全网已知口令）。
 *   本脚本读入口令 → bcrypt 哈希 → 只把哈希写库，明文不落盘、不进仓库、不进日志。
 *
 * 用法（需在 server 目录下执行，且已 npm run build）：
 *   npm run admin:create -- --username admin              # 新建（默认 role=operator）
 *   npm run admin:create -- --username admin --role super  # 新建超级管理员
 *   npm run admin:create -- --username admin --reset       # 重置口令并解绑二次验证
 *
 * 说明：
 *   - 口令通过交互式输入（隐藏回显）；若 stdin 非 TTY（管道/脚本），则从标准输入读一行
 *   - 新建的账号 totp_secret 为空 → 首次登录后强制绑定二次验证（AdminAuthGuard 拦截其余接口）
 *   - --reset 会同时清空 totp_secret：管理员丢失动态码设备时用它回到绑定流程，无需手工改库
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash as bcryptHash } from 'bcryptjs';
import { createInterface } from 'node:readline';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module.js';
import { AdminUserEntity, type AdminRole } from '../modules/admin/entities/admin-user.entity.js';

/** bcrypt 代价因子：与 AdminAuthService 保持一致（12 轮） */
const BCRYPT_ROUNDS = 12;

const MIN_PASSWORD_LENGTH = 12;

interface ScriptOptions {
  username: string;
  role: AdminRole;
  reset: boolean;
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：npm run admin:create -- --username <账号> [--role super|operator] [--reset]',
      '',
      '  --username  管理员登录名（必填，1-64 位）',
      '  --role      角色，默认 operator（super 可管理全部配置域）',
      '  --reset     账号已存在时重置口令并解绑二次验证',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ScriptOptions {
  let username = '';
  let role: AdminRole = 'operator';
  let reset = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--username') {
      username = (argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (arg === '--role') {
      const value = (argv[index + 1] ?? '').trim();
      if (value !== 'super' && value !== 'operator') {
        throw new Error('--role 只能是 super 或 operator');
      }
      role = value;
      index += 1;
      continue;
    }
    if (arg === '--reset') {
      reset = true;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }

  if (!username) throw new Error('缺少 --username');
  if (username.length > 64) throw new Error('--username 最长 64 位');
  return { username, role, reset };
}

/** 隐藏回显地读取一行（TTY 环境）；非 TTY 时退化为普通读取，便于自动化 */
function readPassword(question: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    return new Promise((resolve) => {
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const finish = (result: string): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      resolve(result);
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(value);
          return;
        }
        // Ctrl+C：退出且不留半截账号
        if (char === '\u0003') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          reject(new Error('已取消'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

/** 口令强度：长度 + 至少两类字符。约束过严会逼出「写在便签上」的弱实践，故不要求符号必含 */
function assertPasswordStrength(password: string, username: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`口令长度至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (classes < 2) {
    throw new Error('口令需至少包含小写字母、大写字母、数字、符号中的两类');
  }
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error('口令不得包含账号名');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const password = await readPassword(`请输入 ${options.username} 的口令（输入不回显）：`);
  assertPasswordStrength(password, options.username);
  const confirm = await readPassword('请再次输入以确认：');
  if (password !== confirm) {
    throw new Error('两次输入的口令不一致');
  }

  // 复用应用配置与数据库连接，避免脚本自行解析 .env 造成配置口径分裂
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const repository = app.get<Repository<AdminUserEntity>>(getRepositoryToken(AdminUserEntity));
    const passwordHash = await bcryptHash(password, BCRYPT_ROUNDS);
    const existing = await repository.findOne({ where: { username: options.username } });

    if (existing && !options.reset) {
      throw new Error(
        `账号 ${options.username} 已存在。如需重置口令，请追加 --reset（会同时解绑二次验证）`,
      );
    }

    if (existing) {
      await repository.update(
        { id: existing.id },
        {
          passwordHash,
          role: options.role,
          status: 'active',
          // 重置口令必然同时解绑二次验证：否则「只有口令泄漏」就能被用来接管账号
          totpSecret: null,
        },
      );
      process.stdout.write(
        `已重置账号 ${options.username}（role=${options.role}），二次验证已解绑，请重新登录并绑定\n`,
      );
      return;
    }

    const created = repository.create({
      username: options.username,
      passwordHash,
      role: options.role,
      status: 'active',
    });
    await repository.save(created);
    process.stdout.write(
      `已创建账号 ${options.username}（role=${options.role}）。首次登录后必须绑定二次验证\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
