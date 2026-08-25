import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.DB_PATH || '/data/system-status.db';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS container_samples (
  ts INTEGER NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT,
  health TEXT,
  restart_count INTEGER,
  cpu_percent REAL,
  mem_percent REAL,
  mem_usage INTEGER,
  mem_limit INTEGER
);
CREATE INDEX IF NOT EXISTS idx_container_ts ON container_samples(ts);
CREATE INDEX IF NOT EXISTS idx_container_name_ts ON container_samples(name, ts);

CREATE TABLE IF NOT EXISTS system_samples (
  ts INTEGER NOT NULL,
  cpu_percent REAL,
  mem_used INTEGER,
  mem_total INTEGER,
  mem_percent REAL,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  disk_use_max REAL
);
CREATE INDEX IF NOT EXISTS idx_system_ts ON system_samples(ts);

CREATE TABLE IF NOT EXISTS ip_history (
  ts INTEGER NOT NULL,
  ip TEXT NOT NULL,
  providers TEXT,
  changed INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ip_ts ON ip_history(ts);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT,
  type TEXT,
  title TEXT,
  message TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_ts ON alert_events(ts);
`);

// ============ 写入 ============
export function recordContainerSamples(samples: any[]) {
  const stmt = db.prepare(`
    INSERT INTO container_samples
    (ts, id, name, state, health, restart_count, cpu_percent, mem_percent, mem_usage, mem_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ts = Date.now();
  const tx = db.transaction((rows: any[]) => {
    for (const s of rows) {
      stmt.run(ts, s.id, s.name, s.state, s.health, s.restartCount,
        s.cpuPercent, s.memPercent, s.memUsage, s.memLimit);
    }
  });
  tx(samples);
}

export function recordSystemSample(s: any) {
  const diskMax = Math.max(0, ...(s.disks?.map((d: any) => d.usePercent) || [0]));
  db.prepare(`
    INSERT INTO system_samples
    (ts, cpu_percent, mem_used, mem_total, mem_percent, load1, load5, load15, disk_use_max)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(), s.cpuPercent, s.memUsed, s.memTotal, s.memPercent,
    s.loadAvg?.[0] ?? 0, s.loadAvg?.[1] ?? 0, s.loadAvg?.[2] ?? 0, diskMax
  );
}

export function recordIP(ip: string, providers: string[], changed: boolean) {
  db.prepare(`
    INSERT INTO ip_history (ts, ip, providers, changed)
    VALUES (?, ?, ?, ?)
  `).run(Date.now(), ip, providers.join(','), changed ? 1 : 0);
}

export function recordAlert(level: string, type: string, title: string, message: string) {
  db.prepare(`
    INSERT INTO alert_events (ts, level, type, title, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(Date.now(), level, type, title, message);
}

// ============ Row types ============
export interface SystemRow { ts: number; cpu_percent: number; mem_percent: number; load1: number; disk_use_max: number; }
export interface ContainerRow { ts: number; name: string; cpu_percent: number; mem_percent: number; restart_count: number; }
export interface IPRow { ts: number; ip: string; providers: string; changed: number; }
export interface AlertRow { ts: number; level: string; type: string; title: string; message: string; }

// ============ 读取 ============
export function getSystemSeries(minutes: number): SystemRow[] {
  const since = Date.now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT ts, cpu_percent, mem_percent, load1, disk_use_max
    FROM system_samples WHERE ts >= ? ORDER BY ts ASC
  `).all(since) as SystemRow[];
}

export function getContainerSeries(name: string, minutes: number): ContainerRow[] {
  const since = Date.now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT ts, cpu_percent, mem_percent, restart_count
    FROM container_samples WHERE name = ? AND ts >= ? ORDER BY ts ASC
  `).all(name, since) as ContainerRow[];
}

export function getIPHistory(limit = 50): IPRow[] {
  return db.prepare(`
    SELECT ts, ip, providers, changed FROM ip_history
    ORDER BY ts DESC LIMIT ?
  `).all(limit) as IPRow[];
}

export function getRecentAlerts(limit = 50): AlertRow[] {
  return db.prepare(`
    SELECT ts, level, type, title, message FROM alert_events
    ORDER BY ts DESC LIMIT ?
  `).all(limit) as AlertRow[];
}

export function getLatestContainers(): (ContainerRow & { id: string; state: string; health: string; mem_usage: number; mem_limit: number })[] {
  // 每个容器取最新一条
  return db.prepare(`
    SELECT * FROM container_samples
    WHERE (name, ts) IN (
      SELECT name, MAX(ts) FROM container_samples GROUP BY name
    )
    ORDER BY name
  `).all() as any[];
}

export function getLatestSystem(): SystemRow | undefined {
  return db.prepare(`
    SELECT * FROM system_samples ORDER BY ts DESC LIMIT 1
  `).get() as SystemRow | undefined;
}

// ============ 清理 ============
export function cleanupOldData() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM container_samples WHERE ts < ?').run(cutoff);
  db.prepare('DELETE FROM system_samples WHERE ts < ?').run(cutoff);
  db.prepare('DELETE FROM ip_history WHERE ts < ?').run(cutoff);
  // 告警保留更久一点(30 天)
  const alertCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM alert_events WHERE ts < ?').run(alertCutoff);
  console.log(`[db] cleanup done (retention=${RETENTION_DAYS}d)`);
}
