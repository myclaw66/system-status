# system-status

> Hermes-style ops agent:监控 Ubuntu / Docker / 公网 IP,告警推飞书。

## 功能

- 🐳 **Docker 监控**:容器状态、重启次数、CPU/内存、健康检查
- 🖥️ **系统监控**:CPU、内存、磁盘、负载
- 🌐 **公网 IP 漂移检测**:多源校验,变化告警
- 💬 **飞书告警**:富文本卡片 + @指定人
- 📊 **SQLite 历史数据**:每次采样入库,默认保留 7 天
- 🖼️ **Web 面板**:实时仪表盘 + 趋势图 + 告警流
  - 打开 `http://localhost:8888/web/` 即可
- 🌐 **HTTP / MCP 接口**:给 Hermes / 客户端调用
  - `GET  /health`
  - `GET  /api/docker/containers`
  - `POST /api/docker/restart`
  - `GET  /api/system`
  - `GET  /api/ip`
  - `GET  /api/dashboard`
  - `GET  /api/history/system?minutes=60`
  - `GET  /api/history/ip`
  - `GET  /api/alerts/recent`
  - `GET  /mcp/tools`

## 快速开始

### 1. 创建飞书机器人

群聊 → 设置 → 群机器人 → 添加 → 自定义机器人 → 拿到 **Webhook** 和 **Secret**

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env,填入飞书 webhook 和 secret
```

### 3. 启动

```bash
docker compose up -d
```

### 4. 验证

```bash
curl http://localhost:8888/health
curl http://localhost:8888/api/docker/containers
curl http://localhost:8888/api/system
curl http://localhost:8888/api/ip
```

## 配置说明

`.env`:

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_WEBHOOK` | ✅ | 飞书机器人 Webhook |
| `FEISHU_SECRET` | ⭕ | 签名校验密钥 |
| `FEISHU_AT_MOBILES` | ⭕ | @ 的手机号,逗号分隔 |
| `FEISHU_AT_ALL` | ⭕ | 是否 @所有人 |
| `CHECK_INTERVAL` | ⭕ | 检查间隔(秒),默认 60 |
| `HTTP_PORT` | ⭕ | HTTP 端口,默认 8888（避开 cadence-rocky:final 已用的 8080） |

## 接入 Hermes

Hermes 可以直接通过 HTTP MCP 调这些端点。
在 Hermes 配置里加:

```yaml
mcp_servers:
  - name: system-status
    type: http
    base_url: http://localhost:8888
    tools:
      - name: list_containers
        method: GET
        path: /api/docker/containers
      - name: system_health
        method: GET
        path: /api/system
      - name: check_public_ip
        method: GET
        path: /api/ip
      - name: restart_container
        method: POST
        path: /api/docker/restart
        body_schema:
          type: object
          properties:
            name: { type: string }
```

然后你可以对 Hermes 说:

> "列出所有退出的容器"
> "重启 mysql-01"
> "现在的公网 IP 是什么?"
> "系统健康度怎么样?"

## 项目结构

```
system-status/
├── src/
│   ├── index.ts            # 入口
│   ├── config.ts           # 配置加载
│   ├── mcp/server.ts       # HTTP / MCP 接口
│   ├── monitor/
│   │   ├── docker.ts       # Docker 监控
│   │   ├── system.ts       # 系统监控
│   │   ├── ip.ts           # 公网 IP 检测
│   │   └── loop.ts         # 监控主循环
│   └── alert/
│       ├── feishu.ts       # 飞书 Webhook + 签名
│       └── templates.ts    # 告警模板
├── config/rules.yaml       # 告警规则
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 告警冷却

同类告警默认 **5 分钟** 内不重复推(避免告警风暴)。
可在 `src/monitor/loop.ts` 调整 `COOLDOWN_MS`。

## 安全提示

- ⚠️ `docker.sock` 等于 root 权限,务必只读 `:ro`
- ⚠️ 容器开了 `privileged: true`,生产环境请评估风险
- ⚠️ 飞书 Webhook 不要提交到 Git
