import * as os from 'os';
import { globalCommandRegistry } from './registry';
import { getConfig } from '../config';
import { buildKeyPool, getCurrentProvider } from '../provider';
import { capabilitiesFor, capabilityGlyphs } from '../../core/capabilities';
import { globalTelemetry } from '../../telemetry/telemetry';
import * as headroomProxy from '../../memory/headroomProxy';
import { getHeadroomReport } from '../../memory/headroom.compress';

// One actionable health line. status drives the glyph; detail says what to do when not OK.
function healthLine(status: 'ok' | 'warn' | 'fail', label: string, detail: string): string {
  const glyph = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✗';
  return `- ${glyph} ${label}: ${detail}`;
}

// The real failure modes a user hits — surfaced as pass/warn/fail so "it's broken" becomes actionable.
// Decoupled on purpose: reads the same key pool / proxy singleton / report the engine uses, no DI.
function healthChecks(): string[] {
  const lines: string[] = ['', '**Health checks**'];

  // API keys — an empty pool is why requests silently fail.
  try {
    const keys = buildKeyPool();
    lines.push(keys.length > 0
      ? healthLine('ok', 'API keys', `${keys.length} key(s) · provider ${getCurrentProvider()}`)
      : healthLine('fail', 'API keys', 'none configured — set one in /config or the provider env var'));
  } catch (e: any) {
    lines.push(healthLine('warn', 'API keys', `could not read key pool (${e?.message})`));
  }

  // Headroom compression — live proxy vs. native fallback vs. still provisioning.
  try {
    const r = getHeadroomReport();
    if (headroomProxy.isHeadroomReady?.()) {
      lines.push(healthLine('ok', 'Compression', `Kompress proxy live · ${r.totalSaved.toLocaleString()} tok saved this session`));
    } else if (r.totalSaved > 0) {
      lines.push(healthLine('warn', 'Compression', `native fallback (proxy still provisioning) · ${r.totalSaved.toLocaleString()} tok saved`));
    } else {
      lines.push(healthLine('warn', 'Compression', 'Kompress proxy provisioning — native fallback until ready'));
    }
    // Guard the report invariant the "100% → 0 tok" bug violated, in case it ever regresses live.
    if (r.totalSaved > 0 && r.totalAfter <= 0) {
      lines.push(healthLine('fail', 'Compression math', 'report shows after=0 — this is the old "100% smaller" bug; please report it'));
    }
  } catch (e: any) {
    lines.push(healthLine('warn', 'Compression', `unavailable (${e?.message})`));
  }

  return lines;
}

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

    // Tool latency telemetry
    const toolStats = globalTelemetry.getToolStats();
    const cacheStats = globalTelemetry.getCacheStats();

    const toolLines: string[] = [];
    if (toolStats.length > 0) {
      toolLines.push('', '**Tool latency (this session)**');
      const header = `${'Tool'.padEnd(28)} ${'Calls'.padStart(5)} ${'Avg'.padStart(6)} ${'Min'.padStart(6)} ${'p95'.padStart(6)} ${'Max'.padStart(6)}`;
      toolLines.push('```', header);
      for (const s of toolStats.slice(0, 12)) {
        const name = s.name.slice(0, 27).padEnd(28);
        toolLines.push(`${name} ${String(s.count).padStart(5)} ${(s.avgMs + 'ms').padStart(6)} ${(s.minMs + 'ms').padStart(6)} ${(s.p95Ms + 'ms').padStart(6)} ${(s.maxMs + 'ms').padStart(6)}`);
      }
      toolLines.push('```');
    }

    const cacheLines: string[] = [];
    if (cacheStats.totalPrompt > 0) {
      cacheLines.push('', '**Prompt cache (Anthropic)**');
      cacheLines.push(`- Cache hit rate: ${cacheStats.hitRate} (${cacheStats.readTokens.toLocaleString()} read / ${cacheStats.totalPrompt.toLocaleString()} prompt tokens)`);
      if (cacheStats.creationTokens > 0) cacheLines.push(`- Written to cache: ${cacheStats.creationTokens.toLocaleString()} tokens`);
    }

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
      ...healthChecks(),
      ...toolLines,
      ...cacheLines,
      '',
      '_Spend → /cost · context usage → /context · plugins → /plugins · safety → /security_',
    ];

    return { type: 'message', level: 'info', content: lines.join('\n') };
  },
});
