import express, { Request, Response } from 'express';
import { listContainers, restartContainer } from '../monitor/docker';
import { getSystemMetrics } from '../monitor/system';
import { checkPublicIP } from '../monitor/ip';
import { startWebServer } from '../web';

export function startMCPServer(port: number) {
  const app = express();
  app.use(express.json());

  // 简单的健康检查
  app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

  // Docker
  app.get('/api/docker/containers', async (_, res) => {
    try {
      const data = await listContainers();
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/docker/restart', async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    try {
      const data = await restartContainer(name);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // System
  app.get('/api/system', async (_, res) => {
    try {
      const data = await getSystemMetrics();
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // IP
  app.get('/api/ip', async (_, res) => {
    try {
      const data = await checkPublicIP();
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // MCP-style tools manifest(给 Hermes / 客户端发现工具)
  app.get('/mcp/tools', (_, res) => {
    res.json({
      tools: [
        { name: 'list_containers', desc: 'List all Docker containers with status' },
        { name: 'restart_container', desc: 'Restart a container by name' },
        { name: 'system_health', desc: 'Get CPU/mem/disk/load' },
        { name: 'check_public_ip', desc: 'Check public IP and drift' },
      ],
    });
  });

  app.listen(port, () => {
    console.log(`[http] listening on :${port}`);
    console.log(`  GET  /                       -> dashboard`);
    console.log(`  GET  /web/                   -> dashboard`);
    console.log(`  GET  /health`);
    console.log(`  GET  /api/docker/containers`);
    console.log(`  POST /api/docker/restart  {name}`);
    console.log(`  GET  /api/system`);
    console.log(`  GET  /api/ip`);
    console.log(`  GET  /api/dashboard`);
    console.log(`  GET  /api/history/system?minutes=60`);
    console.log(`  GET  /api/history/ip`);
    console.log(`  GET  /api/alerts/recent`);
    console.log(`  GET  /mcp/tools`);
  });
}
