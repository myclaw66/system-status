FROM node:20-bookworm-slim

# 基础工具 + better-sqlite3 的构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖
COPY package.json ./
RUN npm install --omit=dev=false

# 源码
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build

ENV NODE_ENV=production
ENV RULES_PATH=/app/config/rules.yaml

EXPOSE 8080

CMD ["node", "dist/index.js"]
