import axios from 'axios';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';

const CACHE_PATH = process.env.IP_CACHE_PATH || '/data/last_ip.json';
const PROVIDERS = [
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/all.json',
  'https://ipinfo.io/json',
];

export interface IPCheckResult {
  changed: boolean;
  ip: string;
  old: string | null;
  providers: string[];
}

export async function checkPublicIP(): Promise<IPheckResult> {
  const results = await Promise.allSettled(
    PROVIDERS.map(url =>
      axios.get(url, { timeout: 5000 }).then(r => {
        const data: any = r.data;
        return data.ip || data.ip_address || data.origin;
      })
    )
  );
  const ips = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(Boolean);

  if (ips.length === 0) throw new Error('All IP providers failed');

  // 多数投票
  const counts = new Map<string, number>();
  for (const ip of ips) counts.set(ip, (counts.get(ip) || 0) + 1);
  const currentIP = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 对比上次
  let lastIP: string | null = null;
  if (existsSync(CACHE_PATH)) {
    try {
      lastIP = JSON.parse(readFileSync(CACHE_PATH, 'utf8')).ip;
    } catch (_) {}
  }

  const changed = lastIP !== currentIP;
  if (changed) {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ ip: currentIP, ts: Date.now() }, null, 2));
  }

  return { changed, ip: currentIP, old: lastIP, providers: ips };
}
