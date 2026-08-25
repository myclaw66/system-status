#!/usr/bin/env bash
# Docker daemon 代理一键配置脚本
# 1 次 sudo 密码输入解决问题
set -e

echo "=========================================="
echo "  Docker daemon 代理配置"
echo "=========================================="

# 1. 检查当前是否已有此配置
DROP_IN=/etc/systemd/system/docker.service.d/http-proxy.conf
if [ -f "$DROP_IN" ]; then
    echo "[!] $DROP_IN 已存在，跳过写入（你确认要覆盖吗？）"
    cat "$DROP_IN"
    echo ""
fi

# 2. 写入 drop-in
sudo mkdir -p /etc/systemd/system/docker.service.d/
sudo tee "$DROP_IN" > /dev/null <<'CFG'
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:7897"
Environment="HTTPS_PROXY=http://127.0.0.1:7897"
Environment="NO_PROXY=localhost,127.0.0.1,172.16.0.0/12,192.168.0.0/16,10.0.0.0/8,::1"
CFG
echo "[1/4] drop-in 已写入 → $DROP_IN"

# 3. 重新加载
sudo systemctl daemon-reload
echo "[2/4] systemd 已重载"

# 4. 重启 docker（这是关键一步 — 会 SIGKILL 全部运行中容器）
echo ""
echo "=========================================="
echo "  ⚠️  重启 docker 会 kill 所有运行中容器"
echo "  ⚠️  unless-stopped 的会自启"
echo "  ⚠️  fervent_bardeen (cadence-rocky:final) restart=no，需要手动:"
echo "       docker start fervent_bardeen"
echo "=========================================="
read -p "继续？[y/N] " -r REPLY
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 1
fi
echo ""
sudo systemctl restart docker
echo "[3/4] docker 已重启"

# 5. 等 daemon ready
echo "[4/4] 等 docker daemon ready..."
for i in $(seq 1 15); do
    if sudo systemctl is-active docker >/dev/null 2>&1; then
        echo "    dockerd up (attempt $i)"
        break
    fi
    sleep 1
done

# 6. 自检
echo ""
echo "=========================================="
echo "  自检"
echo "=========================================="
echo "[docker 信息]"
sudo systemctl status docker --no-pager -n 5 | head -8

echo ""
echo "[pull node:20-bookworm-slim 测试]"
if docker pull node:20-bookworm-slim 2>&1 | tail -3; then
    echo ""
    echo "✅ daemon 代理配置成功，daemon 现在能拉镜像"
else
    echo ""
    echo "❌ pull 失败 — 看一下 docker info 的 proxy 配置是否生效"
    docker info 2>&1 | grep -iE "(http|proxy|registry)" | head -5
fi

echo ""
echo "[容器状态]"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1 | head -10
