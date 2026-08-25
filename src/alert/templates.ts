import { FeishuBot } from './feishu.js';
import { AppConfig } from '../config.js';

let bot: FeishuBot;

export function initFeishu(cfg: AppConfig) {
  bot = new FeishuBot(cfg.feishu);
}

function ensure() {
  if (!bot) throw new Error('Feishu bot not initialized');
}

export const alerts = {
  containerDown: (name: string, restartCount: number) => {
    ensure();
    return bot.card({
      title: `🐳 容器异常: ${name}`,
      level: 'danger',
      fields: [
        { label: '容器名', value: name },
        { label: '重启次数', value: String(restartCount) },
        { label: '状态', value: 'exited' },
        { label: '时间', value: new Date().toLocaleString('zh-CN') },
      ],
    });
  },
  containerUnhealthy: (name: string) => {
    ensure();
    return bot.card({
      title: `⚠️ 容器不健康: ${name}`,
      level: 'warning',
      fields: [
        { label: '容器名', value: name },
        { label: 'Health', value: 'unhealthy' },
      ],
    });
  },
  diskFull: (mount: string, used: string) => {
    ensure();
    return bot.card({
      title: `💾 磁盘告警: ${mount}`,
      level: 'danger',
      fields: [
        { label: '挂载点', value: mount },
        { label: '使用率', value: used },
      ],
    });
  },
  highMemory: (percent: number) => {
    ensure();
    return bot.card({
      title: '🧠 内存告警',
      level: 'warning',
      fields: [{ label: '使用率', value: `${percent.toFixed(1)}%` }],
    });
  },
  highCpu: (percent: number) => {
    ensure();
    return bot.card({
      title: '🔥 CPU 告警',
      level: 'warning',
      fields: [{ label: '使用率', value: `${percent.toFixed(1)}%` }],
    });
  },
  ipChanged: (oldIP: string | null, newIP: string) => {
    ensure();
    return bot.text(
      `🌐 公网 IP 变化\n` +
      `${oldIP ?? '无记录'} → ${newIP}\n` +
      `时间: ${new Date().toLocaleString('zh-CN')}`,
    );
  },
  info: (msg: string) => {
    ensure();
    return bot.text(`ℹ️ ${msg}`);
  },
};
