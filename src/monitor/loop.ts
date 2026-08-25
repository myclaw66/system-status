import { AppConfig } from '../config.js';
import { listContainers } from './docker.js';
import { getSystemMetrics } from './system.js';
import { checkPublicIP } from './ip.js';
import { initFeishu, alerts } from '../alert/templates.js';
import { recordAlert } from '../db/index.js';
import { sampleAll } from '../scheduler/sample.js';
import { cleanupOldData } from '../db/index.js';

const state = {
  lastIP: null as string | null,
  lastAlertAt: new Map<string, number>(),
};

const COOLDOWN_MS = 5 * 60 * 1000;

function shouldAlert(key: string): boolean {
  const now = Date.now();
  const last = state.lastAlertAt.get(key) || 0;
  if (now - last < COOLDOWN_MS) return false;
  state.lastAlertAt.set(key, now);
  return true;
}

async function alertAndRecord(
  level: 'info' | 'warning' | 'danger',
  type: string,
  title: string,
  send: () => Promise<any>,
  message = ''
) {
  try {
    await send();
  } catch (_) {}
  recordAlert(level, type, title, message);
}

async function runOnce(cfg: AppConfig) {
  // 1. Docker
  try {
    const containers = await listContainers();
    for (const c of containers) {
      if (c.state === 'exited' && c.restartCount > 0) {
        if (shouldAlert(`docker.down.${c.name}`)) {
          await alertAndRecord('danger', 'container.down',
            `🐳 容器异常: ${c.name}`,
            () => alerts.containerDown(c.name, c.restartCount),
            `重启次数=${c.restartCount}`);
        }
      }
      if (c.health === 'unhealthy') {
        if (shouldAlert(`docker.unhealthy.${c.name}`)) {
          await alertAndRecord('warning', 'container.unhealthy',
            `⚠️ 容器不健康: ${c.name}`,
            () => alerts.containerUnhealthy(c.name));
        }
      }
    }
  } catch (e: any) {
    console.error('[monitor] docker check failed:', e.message);
  }

  // 2. 系统
  try {
    const sys = await getSystemMetrics();
    if (sys.memPercent > 85 && shouldAlert('system.mem')) {
      await alertAndRecord('warning', 'system.memory',
        '🧠 内存告警',
        () => alerts.highMemory(sys.memPercent),
        `mem=${sys.memPercent.toFixed(1)}%`);
    }
    if (sys.cpuPercent > 90 && shouldAlert('system.cpu')) {
      await alertAndRecord('warning', 'system.cpu',
        '🔥 CPU 告警',
        () => alerts.highCpu(sys.cpuPercent),
        `cpu=${sys.cpuPercent.toFixed(1)}%`);
    }
    for (const d of sys.disks) {
      if (d.usePercent > 90 && shouldAlert(`system.disk.${d.mount}`)) {
        await alertAndRecord('danger', 'system.disk',
          `💾 磁盘告警: ${d.mount}`,
          () => alerts.diskFull(d.mount, `${d.usePercent.toFixed(1)}%`),
          `use=${d.usePercent.toFixed(1)}%`);
      }
    }
  } catch (e: any) {
    console.error('[monitor] system check failed:', e.message);
  }

  // 3. 公网 IP
  try {
    const ip = await checkPublicIP();
    if (ip.changed && shouldAlert('ip.changed')) {
      await alertAndRecord('info', 'ip.changed',
        '🌐 公网 IP 变化',
        () => alerts.ipChanged(ip.old, ip.ip),
        `${ip.old ?? '无'} -> ${ip.ip}`);
      state.lastIP = ip.ip;
    }
  } catch (e: any) {
    console.error('[monitor] ip check failed:', e.message);
  }
}

export function startMonitor(cfg: AppConfig) {
  initFeishu(cfg);

  // 监控 + 告警
  runOnce(cfg);
  setInterval(() => runOnce(cfg).catch(() => {}), cfg.checkInterval * 1000);
  console.log(`[monitor] started, interval=${cfg.checkInterval}s`);

  // 采样入库
  sampleAll();
  setInterval(() => sampleAll().catch(() => {}), cfg.checkInterval * 1000);
  console.log(`[sampler] started`);

  // 每天清理一次
  setInterval(() => cleanupOldData(), 24 * 60 * 60 * 1000);
  setTimeout(cleanupOldData, 10 * 1000);  // 启动 10s 后先清一次
}
