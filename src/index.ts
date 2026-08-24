import { startMonitor } from './monitor/loop';
import { startMCPServer } from './mcp/server';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  console.log('[system-status] booting...');
  console.log(`[system-status] check interval: ${cfg.checkInterval}s`);

  // 1. 启动 MCP / HTTP server(给 Hermes / 浏览器用)
  startMCPServer(cfg.httpPort);

  // 2. 启动监控主循环
  startMonitor(cfg);

  console.log('[system-status] ready ✅');
}

main().catch(e => {
  console.error('[system-status] fatal:', e);
  process.exit(1);
});
