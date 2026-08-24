# Dockerfile for system-status monitor
# 多阶段构建：第一阶段安装依赖并编译 TS，第二阶段只保留运行时所需

# ============ Stage 1: deps + build ============
FROM docker.io/library/node:20-bookworm-slim AS builder

# better-sqlite3 需要 node-gyp 原生编译;python3/make/g++
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷 manifest,利用 Docker 层缓存（源码变更不触发重装依赖）
COPY package.json package-lock.json* tsconfig.json ./

# 有 lockfile 用 npm ci（可复现），否则退到 npm install
RUN if [ -f package-lock.json ]; then \
        npm ci; \
    else \
        echo "WARN: package-lock.json not found, falling back to npm install" \
        && npm install --no-audit --no-fund; \
    fi

COPY src ./src
COPY config ./config

# 编译 TypeScript,然后裁掉 devDependencies
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

# ============ Stage 2: runtime ============
FROM docker.io/library/node:20-bookworm-slim AS runtime

# 运行时只需 curl(healthcheck)、ca-certificates(HTTPS 调用 IP provider)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 非 root 用户(uid 1001),与 host uid 冲突时可覆盖
RUN groupadd --system --gid 1001 app \
    && useradd  --system --uid 1001 --gid app --shell /bin/false --home /app app

# 仅拷运行时需要的产物
COPY --from=builder --chown=app:app /app/dist        ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/config       ./config
COPY --from=builder --chown=app:app /app/package.json ./package.json

# SQLite 与 IP cache 的持久化目录,提前建好并赋权
RUN mkdir -p /data && chown -R app:app /data

ENV NODE_ENV=production \
    RULES_PATH=/app/config/rules.yaml \
    DB_PATH=/data/system-status.db \
    IP_CACHE_PATH=/data/last_ip.json \
    HTTP_PORT=8888 \
    CHECK_INTERVAL=60

EXPOSE 8888

# dumb-init 正确转发 SIGTERM/SIGINT 给 node,避免 PID 1 信号丢失
ENTRYPOINT ["dumb-init", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8888/health || exit 1

USER app

CMD ["node", "dist/index.js"]
