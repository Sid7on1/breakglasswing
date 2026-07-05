import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTracer, resetTracerForTests, toOtlpJson, EndedSpan } from '../telemetry/trace';

describe('trace layer (OTel GenAI spans)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-trace-'));
    process.env.BIMAX_TRACE_DIR = dir;
    delete process.env.BIMAX_TRACE;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.BIMAX_OTLP_ENDPOINT;
    resetTracerForTests();
  });

  afterEach(() => {
    delete process.env.BIMAX_TRACE_DIR;
    delete process.env.BIMAX_TRACE;
    resetTracerForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a parent/child span tree with gen_ai attributes', () => {
    const tracer = getTracer();
    const root = tracer.startSpan('invoke_agent bimax', { 'gen_ai.operation.name': 'invoke_agent' });
    const child = tracer.startSpan('chat test-model', { 'gen_ai.request.model': 'test-model' }, root.context);
    child.setAttribute('gen_ai.usage.input_tokens', 123);
    child.end();
    root.end();

    const spans = tracer.recentSpans();
    expect(spans).toHaveLength(2);
    const [chat, agent] = spans;
    expect(chat.name).toBe('chat test-model');
    expect(chat.traceId).toBe(agent.traceId); // same trace
    expect(chat.parentSpanId).toBe(agent.spanId); // parent linkage
    expect(chat.attributes['gen_ai.usage.input_tokens']).toBe(123);
    expect(agent.parentSpanId).toBeUndefined();
  });

  it('end() is idempotent — a second end never double-exports', () => {
    const tracer = getTracer();
    const span = tracer.startSpan('execute_tool ReadFileTool');
    span.end();
    span.end('error', 'should be ignored');
    const spans = tracer.recentSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe('ok');
  });

  it('appends ended spans to the JSONL export file', async () => {
    const tracer = getTracer();
    tracer.startSpan('execute_tool BashTool', { 'gen_ai.tool.name': 'BashTool' }).end('error', 'exit 1');
    // fs.appendFile is async fire-and-forget; give it a tick.
    await new Promise(r => setTimeout(r, 100));
    const content = fs.readFileSync(tracer.exportPath(), 'utf-8').trim();
    const line = JSON.parse(content.split('\n')[0]);
    expect(line.name).toBe('execute_tool BashTool');
    expect(line.status).toBe('error');
    expect(line.statusMessage).toBe('exit 1');
  });

  it('BIMAX_TRACE=0 disables everything — no spans, no files', () => {
    process.env.BIMAX_TRACE = '0';
    resetTracerForTests();
    const tracer = getTracer();
    const span = tracer.startSpan('invoke_agent bimax');
    span.setAttribute('x', 1);
    span.end();
    expect(tracer.isEnabled()).toBe(false);
    expect(tracer.recentSpans()).toHaveLength(0);
    expect(fs.existsSync(tracer.exportPath())).toBe(false);
  });

  it('encodes OTLP/HTTP JSON with typed attribute values', () => {
    const span: EndedSpan = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'chat m',
      startTimeUnixNano: '1000000',
      endTimeUnixNano: '2000000',
      attributes: { 'gen_ai.usage.input_tokens': 5, ratio: 0.5, lite: true, model: 'm' },
      status: 'ok',
    };
    const otlp: any = toOtlpJson([span], 'bimax-test');
    const res = otlp.resourceSpans[0];
    expect(res.resource.attributes[0]).toEqual({ key: 'service.name', value: { stringValue: 'bimax-test' } });
    const encoded = res.scopeSpans[0].spans[0];
    expect(encoded.traceId).toBe('a'.repeat(32));
    expect(encoded.status.code).toBe('STATUS_CODE_OK');
    const attr = Object.fromEntries(encoded.attributes.map((a: any) => [a.key, a.value]));
    expect(attr['gen_ai.usage.input_tokens']).toEqual({ intValue: '5' });
    expect(attr['ratio']).toEqual({ doubleValue: 0.5 });
    expect(attr['lite']).toEqual({ boolValue: true });
    expect(attr['model']).toEqual({ stringValue: 'm' });
  });

  it('caps the in-memory recent-span ring at 200', () => {
    const tracer = getTracer();
    for (let i = 0; i < 230; i++) tracer.startSpan(`s${i}`).end();
    const spans = tracer.recentSpans();
    expect(spans).toHaveLength(200);
    expect(spans[spans.length - 1].name).toBe('s229'); // newest kept
    expect(spans[0].name).toBe('s30'); // oldest 30 dropped
  });
});
