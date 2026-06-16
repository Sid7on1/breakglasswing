import * as os from 'os';
import { globalCommandRegistry } from './registry';
import { getConfig } from '../config';
import { capabilitiesFor, capabilityGlyphs } from '../../core/capabilities';

function fmtDuration(totalSec: number): string {
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);
const GB = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1);

// Diagnostics dashboard (`/diagnostics`) — a one-glance health report for the running session. The
// telemetry exists (memory monitor / watchdog / metrics) but was invisible to the user; this
// surfaces process + system health and the active model's capabilities in plain markdown. Spend is
// in /cost and context usage in /context, so this points there rather than duplicating them.
globalCommandRegistry.register({
  name: '/diagnostics',
  aliases: ['/diag', '/health'],
  category: 'Configuration',
  description: 'Session health — memory, uptime, system & active model capabilities',
  execute: async (_args, _context) => {
    const mem = process.memoryUsage();
    let model = 'default';
    let liteModel = '';
    try { const c = getConfig(); model = c.model || 'default'; liteModel = c.liteModel || ''; } catch { /* config not loaded */ }
    const caps = capabilitiesFor(undefined, model);
    const glyphs = capabilityGlyphs(caps);

    const lines = [
      '## Diagnostics',
      '',
      '**Process**',
      `- Memory (RSS): ${MB(mem.rss)} MB · heap ${MB(mem.heapUsed)}/${MB(mem.heapTotal)} MB${mem.external ? ` · external ${MB(mem.external)} MB` : ''}`,
      `- Uptime: ${fmtDuration(process.uptime())}`,
      `- Node ${process.version} · ${process.platform} ${process.arch} · pid ${process.pid}`,
      '',
      '**System**',
      `- Memory: ${GB(os.totalmem() - os.freemem())} / ${GB(os.totalmem())} GB used`,
      `- CPUs: ${os.cpus().length} · load ${os.loadavg().map(n => n.toFixed(2)).join(' / ')}`,
      '',
      '**Active model**',
      `- Coding: ${model.split('/').pop()}${liteModel ? ` · Lite: ${liteModel.split('/').pop()}` : ''}`,
      `- Context window: ${caps.contextWindow.toLocaleString()} tokens`,
      `- Capabilities: ${glyphs || '(floor — no special capabilities)'}`,
      '',
      '_Spend → /cost · context usage → /context · plugins → /plugins · safety → /security_',
    ];

    return { type: 'message', level: 'info', content: lines.join('\n') };
  },
});
