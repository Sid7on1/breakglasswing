import { gatherMetrics, toOtlpMetricsJson } from '../telemetry/metrics.export';
import { globalTelemetry } from '../telemetry/telemetry';

describe('OTLP metrics export', () => {
  beforeEach(() => globalTelemetry.reset());
  afterEach(() => globalTelemetry.reset());

  it('gathers per-tool latency series and cache counters', () => {
    globalTelemetry.recordToolCall('ReadFileTool', 12);
    globalTelemetry.recordToolCall('ReadFileTool', 20);
    globalTelemetry.recordUsage(1000, 800, 100);

    const points = gatherMetrics();
    const byName = (n: string) => points.filter(p => p.name === n);

    const calls = byName('bimax.tool.calls');
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBe(2);
    expect(calls[0].attributes).toEqual({ 'gen_ai.tool.name': 'ReadFileTool' });
    expect(byName('bimax.tool.duration.avg_ms')[0].value).toBe(16);
    expect(byName('bimax.cache.read_tokens')[0].value).toBe(800);
    expect(byName('bimax.cache.hit_rate_pct')[0].value).toBe(80);
  });

  it('encodes OTLP/HTTP gauge JSON with int/double discrimination', () => {
    const otlp: any = toOtlpMetricsJson([
      { name: 'bimax.tool.calls', value: 3, attributes: { 'gen_ai.tool.name': 'BashTool' } },
      { name: 'bimax.cache.hit_rate_pct', value: 79.5 },
    ], 'bimax-test');

    const metrics = otlp.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(metrics).toHaveLength(2);
    const [calls, rate] = metrics;
    expect(calls.name).toBe('bimax.tool.calls');
    expect(calls.gauge.dataPoints[0].asInt).toBe('3');
    expect(calls.gauge.dataPoints[0].attributes[0]).toEqual({
      key: 'gen_ai.tool.name', value: { stringValue: 'BashTool' },
    });
    expect(rate.gauge.dataPoints[0].asDouble).toBe(79.5);
    expect(otlp.resourceMetrics[0].resource.attributes[0].value.stringValue).toBe('bimax-test');
  });
});
