# 《知伴》服务端镜像（NestJS 12，ESM）
#
# 设计要点（决策与理由见 docs/adr/ADR-006.md）：
#   1. 多阶段构建：构建层装完整依赖（nest CLI / TypeScript）产出 dist；运行层只装生产依赖，
#      镜像更小、攻击面更少，且无需在宿主机维护 Node 运行时。
#   2. **.env 一律不进镜像**：密钥由 compose 的 env_file 在运行期注入（隐私约束：密钥不落镜像层）。
#   3. **时区必须显式 Asia/Shanghai**：报告标题/长图日期用本地时区取 YYYY-MM-DD
#      （double-report-render.service.ts 的 formatDate 用 getFullYear/getMonth/getDate），
#      而 alpine(musl) 默认无时区库 → 必须装 tzdata，否则凌晨时段生成的长图日期会差一天。
#   4. 以非 root（node 用户）运行；健康检查直达应用自身。
#
# 构建：docker compose build api
# 启动：docker compose up -d api

FROM node:22-alpine AS builder
WORKDIR /app

# .npmrc 必须一并拷贝：npm 10.9.x 解析 vitest 的 peer 依赖有 arborist bug，项目固化 legacy-peer-deps=true
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

# tzdata + TZ：报告/长图日期按本地时区渲染（见文件头说明 3）
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

# 健康检查直达应用：/api/health 为 VERSION_NEUTRAL 且无鉴权，容器自身即探针（不依赖宿主机 curl）
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
