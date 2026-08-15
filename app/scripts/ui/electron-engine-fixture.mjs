#!/usr/bin/env node

/**
 * Phase 5 production-boundary engine fixture.
 *
 * Electron main launches this through the same EngineSupervisor adapter as the real engine. The
 * fixture then launches the actual Desktop-provided MCP descriptor from
 * BIMAX_HOST_CAPABILITIES_JSON and forwards its real `mac_control` results as production-qualified
 * tool events. The only fake is the native-world observation attached to the provider's safe
 * `status`/`wait` results: no app is focused and no hardware input is synthesized.
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const descriptor = JSON.parse(process.env.BIMAX_HOST_CAPABILITIES_JSON || '{}');
const spec = descriptor?.servers?.find((server) => server?.name === 'bimax-mac');
if (!spec?.command) throw new Error('Electron did not supply the bimax-mac provider descriptor');

const records = [];
const evidenceFile = process.env.BIMAX_PHASE5_EVIDENCE_FILE || '';
const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const persist = () => {
  if (evidenceFile) writeFileSync(evidenceFile, `${JSON.stringify(records, null, 2)}\n`);
};

const client = new Client({ name: 'bimax-phase5-electron-boundary', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: spec.command,
  args: spec.args || [],
  env: {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || '/tmp',
    ...(spec.env || {}),
    BIMAX_MAC_PROVIDER_DISABLE_NATIVE: '1',
  },
  stderr: 'pipe',
});

await client.connect(transport);

emit({
  t: 'hello', protocolVersion: '3.0', protocolMajor: 3,
  minCompatibleMajor: 3, maxCompatibleMajor: 3,
  engine: { version: 'phase5-boundary-fixture', buildCommit: 'local' },
  features: ['desktop-provider-boundary'],
});
emit({ t: 'ready', protocol: 3 });
emit({ t: 'event', name: 'ui_snapshot', args: [{
  models: { coding: 'phase5-boundary', lite: 'phase5-boundary' },
  contextWindow: 128000, tokensBaseline: 0, sessions: [], checkpoints: [], todos: [],
}] });

let sequence = 0;

function parseText(result) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text || '{}';
  try { return { text, payload: JSON.parse(text) }; }
  catch { return { text, payload: { ok: false, error: 'provider returned non-JSON text' } }; }
}

async function callMac(action, args = {}) {
  const started = new Date();
  const result = await client.callTool({ name: 'mac_control', arguments: { action, ...args } });
  const parsed = parseText(result);
  // Safe fake-native seam: bind the otherwise real provider response to a deterministic app/window
  // so the renderer journey can grade attribution without touching any application on this Mac.
  const payload = parsed.payload?.code
    ? parsed.payload
    : {
      ...parsed.payload,
      app: 'Phase 5 Safe Fixture', pid: process.pid, windowId: 5150,
      frameId: `phase5-frame-${sequence + 1}`,
      ...(action === 'wait' ? {
        actionResult: {
          delivered: true, observed: 'confirmed', confidence: 'proven',
          postcondition: { query: 'safe fixture wait completed', matched: true },
        },
      } : {}),
    };
  const output = JSON.stringify(payload);
  const record = {
    sequence: ++sequence,
    server: spec.name,
    qualifiedTool: `mcp__${spec.name}__mac_control`,
    action,
    isError: result?.isError === true,
    code: payload?.code || null,
    ok: payload?.ok === true,
  };
  records.push(record);
  persist();
  emit({ t: 'event', name: 'tool_call', args: [{
    id: `phase5-mac-${sequence}`,
    toolName: record.qualifiedTool,
    input: JSON.stringify({ action, ...args }),
    output,
    status: result?.isError === true || payload?.ok === false ? 'error' : 'success',
    startTime: started.toISOString(),
    endTime: new Date().toISOString(),
  }] });
  return record;
}

// The first real provider result makes the Mac lane visible before any test action.
await callMac('status');

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  void (async () => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.t !== 'input') return;
    const record = await callMac('wait', { ms: 50 });
    emit({ t: 'event', name: 'message', args: [{
      id: `phase5-answer-${record.sequence}`,
      role: 'assistant',
      content: record.isError
        ? `The safe action was refused (${record.code || 'provider error'}).`
        : 'The freshly issued safe action completed after resume.',
      timestamp: new Date().toISOString(),
    }] });
  })().catch((error) => {
    emit({ t: 'event', name: 'log', args: [{
      id: `phase5-error-${Date.now()}`, level: 'error', text: String(error?.stack || error),
      timestamp: new Date().toISOString(),
    }] });
  });
});

const shutdown = async () => {
  persist();
  await client.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

