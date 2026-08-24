import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  restartCount: number;
  health: string;
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
}

function calcCPUPercent(stats: any): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const sysDelta = stats.cpu_stats.system_cpu_usage -
    stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  if (sysDelta === 0 || cpuDelta === 0) return 0;
  return (cpuDelta / sysDelta) * cpuCount * 100;
}

export async function listContainers(): Promise<ContainerInfo[]> {
  const containers = await docker.listContainers({ all: true });
  return Promise.all(containers.map(async (c) => {
    const ctr = docker.getContainer(c.Id);
    let stats: any = {};
    let inspect: any = {};
    try {
      stats = await ctr.stats({ stream: false });
    } catch (_) { /* 刚停止的容器可能 stats 拉不到 */ }
    try {
      inspect = await ctr.inspect();
    } catch (_) {}

    const memUsage = stats.memory_stats?.usage ?? 0;
    const memLimit = stats.memory_stats?.limit ?? 0;
    return {
      id: c.Id.slice(0, 12),
      name: (c.Names[0] || '').replace('/', ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      restartCount: inspect.RestartCount ?? 0,
      health: inspect.State?.Health?.Status ?? 'none',
      cpuPercent: Number(calcCPUPercent(stats).toFixed(2)),
      memUsage,
      memLimit,
      memPercent: memLimit > 0 ? Number(((memUsage / memLimit) * 100).toFixed(2)) : 0,
    };
  }));
}

export async function restartContainer(name: string) {
  const ctr = docker.getContainer(name);
  await ctr.restart();
  return { ok: true, name };
}
