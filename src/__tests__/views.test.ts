import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLedger } from '../mind/event.ledger';
import { SelfModel } from '../mind/self.model';
import { foldSelfModel } from '../mind/views';
import { mcpChildEnv } from '../mcp/client';

describe('materialized views (v2 D1) — self-model refold from the ledger', () => {
  let dir: string;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-views-'));
    ledger = new EventLedger(dir);
  });
  afterEach(() => {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const emit = (tool: string, domain: string, status: string, model = 'm1', errSample?: string) =>
    ledger.append('tool_outcome', { tool, domain, status, model, errSample });

  it('folds tool_outcome events into the same totals the live loop would have recorded', () => {
    emit('EditFileTool', 'ts', 'ok');
    emit('EditFileTool', 'ts', 'error', 'm1', '[not_found] Error: nope');
    emit('EditFileTool', 'ts', 'ok');
    emit('BashTool', 'tsc', 'ok');
    emit('EditFileTool', 'ts', 'rejected');   // preference data — must be skipped
    emit('BashTool', 'curl', 'blocked');      // policy data — must be skipped

    const { model, replayed, skipped } = foldSelfModel(ledger.byType('tool_outcome'), dir);
    expect(replayed).toBe(4);
    expect(skipped).toBe(2);
    const totals = model.cellTotals();
    expect(totals['EditFileTool|ts|m1']).toEqual({ ok: 2, err: 1 });
    expect(totals['BashTool|tsc|m1']).toEqual({ ok: 1, err: 0 });
    expect(totals['EditFileTool|ts|-']).toBeUndefined(); // model key came from the EVENT
  });

  it('attributes events to the model that produced them, not the active one', () => {
    emit('BashTool', 'go', 'error', 'llama-70b');
    emit('BashTool', 'go', 'ok', 'gpt-x');
    const totals = foldSelfModel(ledger.byType('tool_outcome'), dir).model.cellTotals();
    expect(totals['BashTool|go|llama-70b']).toEqual({ ok: 0, err: 1 });
    expect(totals['BashTool|go|gpt-x']).toEqual({ ok: 1, err: 0 });
  });

  it('refold is deterministic: two folds over the same log produce identical totals', () => {
    for (let i = 0; i < 25; i++) emit('EditFileTool', 'ts', i % 3 === 0 ? 'error' : 'ok');
    const a = foldSelfModel(ledger.byType('tool_outcome'), dir).model.cellTotals();
    const b = foldSelfModel(ledger.byType('tool_outcome'), dir).model.cellTotals();
    expect(a).toEqual(b);
  });

  it('the folded model persists and reads back as a normal self-model file', () => {
    emit('EditFileTool', 'ts', 'ok');
    emit('EditFileTool', 'ts', 'error', 'm1', 'boom');
    const { model } = foldSelfModel(ledger.byType('tool_outcome'), dir);
    model.saveNow();
    const fresh = new SelfModel(dir);
    expect(fresh.cellTotals()['EditFileTool|ts|m1']).toEqual({ ok: 1, err: 1 });
  });
});

describe('MCP child env (v2 threat model cut #4)', () => {
  afterEach(() => {
    delete process.env.BIMAX_MCP_ENV_INHERIT;
    delete process.env.BGW_FAKE_MCP_SECRET;
  });

  it('scrubs the parent env: baseline + declared env only — global API keys never leak', () => {
    process.env.BGW_FAKE_MCP_SECRET = 'sk-leaky';
    const env = mcpChildEnv({ name: 's', command: 'node', env: { DECLARED_KEY: 'ok' } } as any);
    expect(env.BGW_FAKE_MCP_SECRET).toBeUndefined();
    expect(env.DECLARED_KEY).toBe('ok');
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });

  it('BIMAX_MCP_ENV_INHERIT=1 restores the legacy full-inherit behavior explicitly', () => {
    process.env.BGW_FAKE_MCP_SECRET = 'sk-leaky';
    process.env.BIMAX_MCP_ENV_INHERIT = '1';
    const env = mcpChildEnv({ name: 's', command: 'node' } as any);
    expect(env.BGW_FAKE_MCP_SECRET).toBe('sk-leaky');
  });
});
