import express from 'express';
import { startMonitor } from './monitor/loop.js';
import { startMCPServer } from './mcp/server.js';
import { startWebServer } from './web/index.js';
import { loadConfig } from './config.js';

async function main() {
  const cfg = loadConfig();
  console.log('[system-status] booting...');
  console.log(`[system-status] check interval: ${cfg.checkInterval}s`);

  // 1. 启动 MCP / HTTP server(给 Hermes / 浏览器用)
  await startMCPServer(8889);

  // 2. 启动 Web 服务器(Express + 静态文件 + API)
  const app = express();
  startWebServer(app, cfg.httpPort);

  // 3. 启动监控主循环
  startMonitor(cfg);

  console.log('[system-status] ready ✅');
}

// Export MCP server start for use by the MCP CLI mode
export { startMCPServer };

main().catch(e => {
  console.error('[system-status] fatal:', e);
  process.exit(1);
});
