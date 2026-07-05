import { globalTelemetry } from './telemetry';
import { Logger } from '../utils/logger';

/**
 * OTLP metrics exporter — the time-series counterpart of trace.ts. Gathers the counters the
 * engine already keeps (per-tool latency stats, prompt-cache hit rate, Headroom compression
 * savings) into OTLP/HTTP JSON gauges/sums and POSTs them to {endpoint}/v1/metrics on an
 * interval, so a Grafana/Datadog dashboard gets live series instead of only spans.
 *
 * Zero dependencies, entirely off unless OTEL_EXPORTER_OTLP_ENDPOINT (or BIMAX_OTLP_ENDPOINT)
 * is set. Gauge semantics: every export reports the CURRENT session-cumulative value with a
 * fresh timestamp — backends diff/rate() as needed.
 */

interface MetricPoint {
  name: string;
  value: number;
  attributes?: Record<string, string>;
}

/** Snapshot every exportable counter the engine tracks right now. */
export function gatherMetrics(): MetricPoint[] {
  const out: MetricPoint[] = [];

  for (const t of globalTelemetry.getToolStats()) {
    const attrs = { 'gen_ai.tool.name': t.name };
    out.push({ name: 'bimax.tool.calls', value: t.count, attributes: attrs });
    out.push({ name: 'bimax.tool.duration.avg_ms', value: t.avgMs, attributes: attrs });
    out.push({ name: 'bimax.tool.duration.p95_ms', value: t.p95Ms, attributes: attrs });
  }

  const cache = globalTelemetry.getCacheStats();
  out.push({ name: 'bimax.cache.read_tokens', value: cache.readTokens });
  out.push({ name: 'bimax.cache.creation_tokens', value: cache.creationTokens });
  out.push({ name: 'bimax.prompt.total_tokens', value: cache.totalPrompt });
  const rate = parseFloat(cache.hitRate);
  if (Number.isFinite(rate)) out.push({ name: 'bimax.cache.hit_rate_pct', value: rate });

  // Headroom compression savings — optional subsystem, must never break metrics gathering.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getHeadroomReport } = require('../memory/headroom.compress') as typeof import('../memory/headroom.compress');
    const r = getHeadroomReport();
    if (r && typeof r.totalSaved === 'number') {
      out.push({ name: 'bimax.compression.saved_tokens', value: r.totalSaved });
    }
  } catch { /* headroom optional */ }

  return out;
}

/** OTLP/HTTP JSON encoding: every point as a gauge (backends rate()/diff() as needed). */
export function toOtlpMetricsJson(points: MetricPoint[], serviceName = 'bimax'): object {
  const now = `${Date.now()}000000`;
  const attrList = (attrs: Record<string, string> = {}) =>
    Object.entries(attrs).map(([key, v]) => ({ key, value: { stringValue: v } }));
  return {
    resourceMetrics: [{
      resource: { attributes: attrList({ 'service.name': serviceName }) },
      scopeMetrics: [{
        scope: { name: 'bimax.metrics', version: '1' },
        metrics: points.map(p => ({
          name: p.name,
          gauge: {
            dataPoints: [{
              timeUnixNano: now,
              ...(Number.isInteger(p.value) ? { asInt: String(p.value) } : { asDouble: p.value }),
              attributes: attrList(p.attributes),
            }],
          },
        })),
      }],
    }],
  };
}

let _timer: NodeJS.Timeout | null = null;

/** POST one metrics snapshot now. No-op without an endpoint. */
export async function exportMetricsNow(): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.BIMAX_OTLP_ENDPOINT;
  if (!endpoint) return false;
  const points = gatherMetrics();
  if (points.length === 0) return false;
  try {
    await fetch(endpoint.replace(/\/$/, '') + '/v1/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toOtlpMetricsJson(points)),
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch (e: any) {
    Logger.warn(`[Metrics] OTLP export failed: ${e?.message}`);
    return false;
  }
}

/**
 * Start the periodic exporter (default every 60s). Silent no-op when no OTLP endpoint is
 * configured, so boot can call this unconditionally. unref'd — never keeps the process alive.
 */
export function startMetricsExporter(intervalMs = 60_000): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.BIMAX_OTLP_ENDPOINT;
  if (_timer || !endpoint) return;
  _timer = setInterval(() => void exportMetricsNow(), intervalMs);
  _timer.unref?.();
}

export function stopMetricsExporter(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
