#!/usr/bin/env bash
#
# 创建 / 重置后台管理员账号（模块 8，ADR-003 决策 4）
#
# 为什么要有这个包装脚本（而不是直接敲 npm 命令）：
#   服务器上有两个 node：/usr/local/bin/node 是 v18 且在 PATH 里优先，/usr/bin/node 才是 v22；
#   且服务器 ~/.npmrc 里有一个已失效的代理，不覆盖会让 npm 的一切下载动作 ETIMEDOUT。
#   这两点极易漏掉，故把环境修正固化在这里。
#
# 用法（服务器上任意目录均可执行）：
#   ./deploy/create-admin.sh --username <账号> --role super
#   ./deploy/create-admin.sh --username <账号> --role operator
#   ./deploy/create-admin.sh --username <账号> --reset     # 重置口令并解绑二次验证
#
# 非交互用法（口令从标准输入读两行：口令 + 确认）：
#   printf '%s\n%s\n' "$PW" "$PW" | ./deploy/create-admin.sh --username admin --role super
#   ⚠️ 这种方式口令会残留在 shell 历史里，仅在确实无法交互时使用
#
# 口令规则（Node 侧脚本强校验，不满足直接拒绝）：
#   ≥12 位、至少含「小写字母 / 大写字母 / 数字 / 符号」中的两类、不得包含账号名。
# 口令经 bcrypt(12) 哈希后入库 —— 明文不落盘、不进日志、不进仓库。
# 新建账号的 totp_secret 为空 → 首次登录会被强制引导绑定二次验证（防「只有口令就能用」）。
#
# 前置条件：server/.env 已配好 DB_* 与 REDIS_*（脚本复用应用的配置加载，不再单独解析 .env）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"

usage() {
  # 写死相对路径而非 $0：$0 会带上调用时的 ./ 或绝对路径，回显不好看
  echo "用法：deploy/create-admin.sh --username <账号> [--role super|operator] [--reset]" >&2
  echo "" >&2
  echo "  --username  管理员登录名（必填，1-64 位）" >&2
  echo "  --role      角色，默认 operator（super 可管理全部配置域）" >&2
  echo "  --reset     账号已存在时重置口令并解绑二次验证" >&2
}

# ---- 环境修正（服务器特有的两个坑，详见文件头）----
export PATH="/usr/bin:${PATH}"      # v22 优先，避免落到 v18
export npm_config_proxy=null        # 必须写 null；空字符串不生效
export npm_config_https_proxy=null

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

if [[ ! -f "${SERVER_DIR}/package.json" ]]; then
  echo "错误：未找到 ${SERVER_DIR}/package.json，请确认本脚本仍在仓库的 deploy/ 目录下" >&2
  exit 1
fi

cd "${SERVER_DIR}"

# 构建产物缺失时自动补齐：避免「脚本跑不起来，还得先看懂构建流程」
# （nest build 需要 devDependencies，故 node_modules 缺失时先 npm ci）
if [[ ! -f dist/scripts/create-admin.js ]]; then
  echo "[create-admin] 未找到 dist/scripts/create-admin.js，正在准备（首次可能较慢）…" >&2
  if [[ ! -d node_modules ]]; then
    npm ci
  fi
  npm run build
fi

# 必须在 server 目录下执行：脚本内部用 NestFactory 加载应用配置（含 server/.env）
exec node dist/scripts/create-admin.js "$@"
