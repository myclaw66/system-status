import si from 'systeminformation';
import { loadavg as nodeLoadavg } from 'os';

export interface SystemMetrics {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  memPercent: number;
  loadAvg: [number, number, number];
  disks: Array<{ fs: string; used: number; size: number; usePercent: number; mount: string }>;
  uptime: number;
  hostname: string;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const nodeLoad = nodeLoadavg(); // [1min, 5min, 15min] -1 on unsupported platforms
  const [load, mem, fs, osInfo, cpu] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.cpu(),
  ]);
  return {
    cpuPercent: Number(load.currentLoad.toFixed(2)),
    memUsed: mem.active,
    memTotal: mem.total,
    memPercent: Number(((mem.active / mem.total) * 100).toFixed(2)),
    loadAvg: [
      Number(load.avgLoad.toFixed(2)),
      Number((nodeLoad[1] >= 0 ? nodeLoad[1] : load.avgLoad).toFixed(2)),
      Number((nodeLoad[2] >= 0 ? nodeLoad[2] : load.avgLoad).toFixed(2)),
    ],
    disks: fs.map(d => ({
      fs: d.fs,
      mount: d.mount,
      used: d.used,
      size: d.size,
      usePercent: d.use,
    })),
    uptime: si.time().uptime,
    hostname: osInfo.hostname,
  };
}
