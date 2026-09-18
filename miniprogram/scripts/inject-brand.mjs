#!/usr/bin/env node
/**
 * 构建期注入品牌信息（ADR-002 决策 3）
 *
 * 为什么需要它：
 *   uni-app 的 src/manifest.json 与 src/pages.json 在**编译期**被写进小程序包
 *   （@dcloudio/uni-cli-shared 直接用 fs 读取并做 JSON 预处理，不支持运行时/环境变量插值），
 *   所以品牌名没法像页面文案那样由接口下发。此脚本在构建前把 .env 中的品牌配置写进
 *   manifest.json / pages.json / index.html，使品牌名的唯一真源集中在 miniprogram/.env，
 *   源码中不出现品牌名字面量。
 *
 * 用法（已挂在 package.json 的 pre 钩子上，正常无需手工执行）：
 *   node scripts/inject-brand.mjs --mode production
 *
 * 幂等：内容无变化时不写文件，避免无意义改动与 git 噪声。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 解析 --mode=（与 uni/vite 的 mode 保持一致：dev → development，build → production） */
function readMode() {
  const index = process.argv.findIndex((arg) => arg === '--mode');
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];

  const inline = process.argv.find((arg) => arg.startsWith('--mode='));
  if (inline) return inline.slice('--mode='.length);

  return 'development';
}

function readRequiredEnv(env, key) {
  const value = (env[key] ?? '').trim();
  if (!value) {
    throw new Error(
      `缺少环境变量 ${key}，请检查 miniprogram/.env（品牌展示配置的唯一真源，见 ADR-002）`,
    );
  }
  return value;
}

const mode = readMode();
const env = loadEnv(mode, projectRoot, 'VITE_');
const brandName = readRequiredEnv(env, 'VITE_BRAND_NAME');
const brandDescription = readRequiredEnv(env, 'VITE_BRAND_DESCRIPTION');

/** 写入 JSON；内容一致则跳过（保证幂等） */
function writeJsonIfChanged(relativePath, data) {
  const filePath = path.join(projectRoot, relativePath);
  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (readFileSync(filePath, 'utf8') === next) return false;

  writeFileSync(filePath, next, 'utf8');
  return true;
}

/** 写入 index.html 的 <title>（仅 H5 构建会用到）；内容一致则跳过 */
function writeHtmlTitleIfChanged(relativePath, title) {
  const filePath = path.join(projectRoot, relativePath);
  const current = readFileSync(filePath, 'utf8');
  const next = current.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  if (next === current) return false;

  writeFileSync(filePath, next, 'utf8');
  return true;
}

// manifest.json：小程序名称与描述（h5.title 仅构建 H5 时用到）
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'src/manifest.json'), 'utf8'));
manifest.name = brandName;
manifest.description = brandDescription;
if (manifest.h5) manifest.h5.title = brandName;

// pages.json：只注入全局标题，页面级不再写品牌名（首页在运行时还会被 uni.setNavigationBarTitle 覆盖）
const pagesJson = JSON.parse(readFileSync(path.join(projectRoot, 'src/pages.json'), 'utf8'));
pagesJson.globalStyle = pagesJson.globalStyle ?? {};
pagesJson.globalStyle.navigationBarTitleText = brandName;

const changed = [
  writeJsonIfChanged('src/manifest.json', manifest),
  writeJsonIfChanged('src/pages.json', pagesJson),
  writeHtmlTitleIfChanged('index.html', brandName),
].filter(Boolean);

if (changed.length > 0) {
  console.log(`[brand] mode=${mode} 已注入品牌信息：${brandName}`);
} else {
  console.log(`[brand] mode=${mode} 品牌信息已是最新：${brandName}`);
}
