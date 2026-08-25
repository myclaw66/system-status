import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { listContainers, restartContainer, ContainerInfo } from '../monitor/docker.js';
import { getSystemMetrics, SystemMetrics } from '../monitor/system.js';
import { checkPublicIP, IPCheckResult } from '../monitor/ip.js';
import {
  getSystemSeries,
  getContainerSeries,
  getIPHistory,
  getRecentAlerts,
} from '../db/index.js';

// ============================================================
// Tool definitions
// ============================================================

const TOOLS: Tool[] = [
  {
    name: 'list_containers',
    description: 'List all Docker containers with their status, CPU, and memory usage. Use this to monitor all running and stopped containers on the host.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional name filter (partial match)',
        },
      },
    },
  },
  {
    name: 'restart_container',
    description: 'Restart a Docker container by name. Returns success confirmation or error if container not found.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Container name to restart (e.g. "system-status", "cadence-rocky")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'system_health',
    description: 'Get current CPU, memory, disk, load average, and uptime of the host system. Returns raw numbers (bytes for memory/disk, percentage for CPU).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'public_ip',
    description: 'Check the current public IP address. Returns current IP, previous IP, and whether it changed since last check.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'container_stats',
    description: 'Get detailed resource usage history for a specific container over time.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Container name (e.g. "system-status", "cadence-rocky")',
        },
        minutes: {
          type: 'number',
          description: 'Time window in minutes (default: 60)',
          default: 60,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'history',
    description: 'Get historical system metrics from the database.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['system', 'container', 'ip', 'alerts'],
          description: 'Type of history: "system" (CPU/mem/load over time), "container" (per-container), "ip" (IP changes), "alerts" (recent alerts)',
        },
        name: {
          type: 'string',
          description: 'Container name (required for type="container")',
        },
        minutes: {
          type: 'number',
          description: 'Time window in minutes (default: 60, max 10080 for 7 days)',
          default: 60,
        },
      },
      required: ['type'],
    },
  },
];

// ============================================================
// Server implementation
// ============================================================

const server = new Server(
  {
    name: 'system-status',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Register call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_containers': {
        const allContainers = await listContainers();
        const filter = (args as any)?.filter?.toLowerCase();
        const filtered = filter
          ? allContainers.filter(c => c.name.toLowerCase().includes(filter))
          : allContainers;

        const lines = filtered.map(c => {
          const cpuBar = bar(c.cpuPercent);
          const memBar = bar(c.memPercent);
          const state = c.state === 'running' ? '🟢' : '⚫';
          return [
            `${state} ${c.name}`,
            `   image: ${c.image}`,
            `   status: ${c.status}`,
            `   CPU: ${cpuBar} ${c.cpuPercent}%`,
            `   MEM: ${memBar} ${c.memPercent}%`,
          ].join('\n');
        });

        return {
          content: [
            {
              type: 'text',
              text: lines.length > 0
                ? `## Docker Containers (${filtered.length}/${allContainers.length})\n\n${lines.join('\n\n')}`
                : 'No containers found.',
            },
          ],
        };
      }

      case 'restart_container': {
        const { name: cName } = args as { name: string };
        if (!cName) {
          throw new Error('Container name is required');
        }
        await restartContainer(cName);
        return {
          content: [{ type: 'text', text: `✅ Container "${cName}" restarted successfully.` }],
        };
      }

      case 'system_health': {
        const m = await getSystemMetrics();
        const memUsedGB = (m.memUsed / 1e9).toFixed(1);
        const memTotalGB = (m.memTotal / 1e9).toFixed(1);

        return {
          content: [
            {
              type: 'text',
              text: `## System Health\n` +
                `| Metric | Value |\n` +
                `|--------|-------|\n` +
                `| CPU | ${m.cpuPercent}% ${bar(m.cpuPercent)} |\n` +
                `| Memory | ${memUsedGB} / ${memTotalGB} GB (${m.memPercent}%) |\n` +
                `| Load Avg | ${m.loadAvg.join(' / ')} |\n` +
                `| Uptime | ${formatUptime(m.uptime)} |\n` +
                `| Hostname | ${m.hostname} |\n\n` +
                `### Disks\n` +
                m.disks.map(d => {
                  const usedGB = (d.used / 1e9).toFixed(0);
                  const totalGB = (d.size / 1e9).toFixed(0);
                  return `- **${d.mount}**: ${usedGB}/${totalGB} GB (${d.usePercent}%) ${bar(d.usePercent)}`;
                }).join('\n'),
            },
          ],
        };
      }

      case 'public_ip': {
        const result: IPCheckResult = await checkPublicIP();
        const changed = result.changed ? '🔄 **CHANGED**' : '✅ unchanged';
        return {
          content: [
            {
              type: 'text',
              text: `## Public IP\n` +
                `| Field | Value |\n` +
                `|-------|-------|\n` +
                `| Current | **${result.ip}** |\n` +
                `| Previous | ${result.old ?? '(none)'} |\n` +
                `| Status | ${changed} |\n` +
                `| Providers | ${result.providers.join(', ')} |`,
            },
          ],
        };
      }

      case 'container_stats': {
        const { name: cName, minutes = 60 } = args as { name: string; minutes?: number };
        if (!cName) throw new Error('Container name is required');
        const series = getContainerSeries(cName, minutes);
        if (series.length === 0) {
          return { content: [{ type: 'text', text: `No data for container "${cName}" in the last ${minutes} minutes.` }] };
        }
        const latest = series[series.length - 1];
        return {
          content: [
            {
              type: 'text',
              text: `## ${cName} (last ${minutes}min, ${series.length} samples)\n` +
                `Latest: CPU ${latest.cpu_percent?.toFixed(1) ?? 0}% | MEM ${latest.mem_percent?.toFixed(1) ?? 0}%\n` +
                summary(series.map(s => ({ cpu: s.cpu_percent, mem: s.mem_percent }))),
            },
          ],
        };
      }

      case 'history': {
        const { type, name: cName, minutes = 60 } = args as { type: string; name?: string; minutes?: number };

        if (type === 'system') {
          const rows = getSystemSeries(minutes);
          return {
            content: [
              {
                type: 'text',
                text: rows.length === 0
                  ? 'No system history available.'
                  : `## System History (${minutes}min, ${rows.length} samples)\n` +
                    `| Time | CPU% | MEM% | Load1 | Disk% |\n` +
                    `|------|------|------|-------|-------|\n` +
                    rows.slice(-20).map(r => {
                      const t = new Date(r.ts).toLocaleTimeString();
                      return `| ${t} | ${r.cpu_percent?.toFixed(1) ?? 0} | ${r.mem_percent?.toFixed(1) ?? 0} | ${r.load1?.toFixed(2) ?? 0} | ${r.disk_use_max?.toFixed(1) ?? 0} |`;
                    }).join('\n'),
              },
            ],
          };
        }

        if (type === 'container') {
          if (!cName) throw new Error('Container name required for type=container');
          const rows = getContainerSeries(cName, minutes);
          return {
            content: [
              {
                type: 'text',
                text: rows.length === 0
                  ? `No data for container "${cName}".`
                  : `## ${cName} History (${minutes}min)\n` +
                    rows.slice(-20).map(r => {
                      const t = new Date(r.ts).toLocaleTimeString();
                      return `${t} — CPU ${r.cpu_percent?.toFixed(1) ?? 0}% MEM ${r.mem_percent?.toFixed(1) ?? 0}%`;
                    }).join('\n'),
              },
            ],
          };
        }

        if (type === 'ip') {
          const rows = getIPHistory(50);
          return {
            content: [
              {
                type: 'text',
                text: rows.length === 0
                  ? 'No IP history.'
                  : `## IP History\n` +
                    rows.slice(0, 10).map(r => {
                      const t = new Date(r.ts).toLocaleString();
                      const changed = r.changed ? '🔄' : '';
                      return `${t} ${changed} **${r.ip}**`;
                    }).join('\n'),
              },
            ],
          };
        }

        if (type === 'alerts') {
          const rows = getRecentAlerts(50);
          return {
            content: [
              {
                type: 'text',
                text: rows.length === 0
                  ? 'No recent alerts. ✅'
                  : `## Recent Alerts\n` +
                    rows.map(r => {
                      const t = new Date(r.ts).toLocaleString();
                      return `**[${r.level.toUpperCase()}]** ${r.title} — ${t}\n${r.message}`;
                    }).join('\n\n'),
              },
            ],
          };
        }

        throw new Error(`Unknown history type: ${type}`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `❌ Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ============================================================
// Helpers
// ============================================================

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function summary(points: Array<{ cpu?: number; mem?: number }>): string {
  if (points.length < 2) return '';
  const avgCpu = points.reduce((s, p) => s + (p.cpu ?? 0), 0) / points.length;
  const maxCpu = Math.max(...points.map(p => p.cpu ?? 0));
  const avgMem = points.reduce((s, p) => s + (p.mem ?? 0), 0) / points.length;
  const maxMem = Math.max(...points.map(p => p.mem ?? 0));
  return `\nAvg: CPU ${avgCpu.toFixed(1)}% MEM ${avgMem.toFixed(1)}% | Max: CPU ${maxCpu.toFixed(1)}% MEM ${maxMem.toFixed(1)}%`;
}

// ============================================================
// Main
// ============================================================

export async function startMCPServer(port: number = 8889) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await server.connect(transport);

  const httpServer = createHttpServer((req, res) => {
    // Inject body parsing for POST requests
    if (req.method === 'POST' || req.method === 'GET') {
      let body: any = undefined;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString());
          } catch {}
          transport.handleRequest(req, res, body);
        });
      } else {
        transport.handleRequest(req, res, undefined);
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[mcp] HTTP server listening on http://0.0.0.0:${port}/mcp`);
  });
}

// CLI mode: stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] MCP server started on stdio');
}

// Run as script (not imported)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => {
    console.error('[mcp] fatal:', e);
    process.exit(1);
  });
}
