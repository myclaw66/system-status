import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import {
  getSystemSeries,
  getContainerSeries,
  getIPHistory,
  getRecentAlerts,
  getLatestContainers,
  getLatestSystem,
} from '../db';

export function startWebServer(app: express.Express, port: number) {
  // 静态文件
  const publicDir = path.join(__dirname, 'public');
  app.use('/web', express.static(publicDir));

  // 历史 API
  app.get('/api/history/system', (req: Request, res: Response) => {
    const minutes = Number(req.query.minutes || 60);
    res.json({ ok: true, data: getSystemSeries(minutes) });
  });

  app.get('/api/history/container', (req: Request, res: Response) => {
    const name = String(req.query.name || '');
    const minutes = Number(req.query.minutes || 60);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    res.json({ ok: true, data: getContainerSeries(name, minutes) });
  });

  app.get('/api/history/ip', (_, res) => {
    res.json({ ok: true, data: getIPHistory(50) });
  });

  app.get('/api/alerts/recent', (_, res) => {
    res.json({ ok: true, data: getRecentAlerts(50) });
  });

  // 实时状态
  app.get('/api/dashboard', (_, res) => {
    res.json({
      ok: true,
      data: {
        latestSystem: getLatestSystem(),
        containers: getLatestContainers(),
      },
    });
  });

  // 把 / 重定向到面板
  app.get('/', (_, res) => res.redirect('/web/'));
  console.log(`[web] dashboard at http://localhost:${port}/web/`);
}
