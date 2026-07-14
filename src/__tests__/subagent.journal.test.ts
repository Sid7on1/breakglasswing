import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLedger } from '../mind/event.ledger';
import { foldSubagentRuns, summarizeRun, SubagentJournalEvent } from '../core/subagent.journal';

// WS2.2 — the fold must split a spawn's wall time into boot overhead (ours), the model's
// time-to-first-action, the tool loop, and total. These are pure asserts over a synthetic
// journal in an isolated ledger — no worker thread, no LLM call.
describe('subagent journal — boot vs model-latency split', () => {
  let dir: string;
  let ledger: EventLedger;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-journal-'));
    ledger = new EventLedger(dir);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const append = (ev: SubagentJournalEvent) => ledger.append('subagent', ev);

  it('folds spawned→ready→first_event→tool_call→settled into a timing row', () => {
    if (!ledger.isAvailable()) { console.warn('node:sqlite unavailable — skipping'); return; }

    const taskId = 'swarm-test-1';
    append({ taskId, phase: 'spawned', agentType: 'OpenCode' });
    append({ taskId, phase: 'ready', ms: 800 });         // 800ms of boot overhead (ours)
    append({ taskId, phase: 'first_event', ms: 2200 });  // first action at 2200ms → model took 1400ms
    append({ taskId, phase: 'tool_call', tool: 'Bash', ms: 2200 });
    append({ taskId, phase: 'tool_call', tool: 'Edit', ms: 3100 });
    append({ taskId, phase: 'settled', outcome: 'done', ms: 4000, toolCalls: 2 });

    const runs = foldSubagentRuns(ledger);
    const run = runs.find(r => r.taskId === taskId);
    expect(run).toBeDefined();
    expect(run!.agentType).toBe('OpenCode');
    expect(run!.msToReady).toBe(800);       // boot overhead surfaced separately
    expect(run!.msToFirstEvent).toBe(2200); // first substantive event (NOT overwritten by 'ready')
    expect(run!.msTotal).toBe(4000);
    expect(run!.outcome).toBe('done');
    expect(run!.toolCalls).toBe(2);
    expect(run!.calls.map(c => c.tool)).toEqual(['Bash', 'Edit']);

    // The whole point: model latency = first_event − ready is derivable and distinct from boot.
    expect(run!.msToFirstEvent! - run!.msToReady!).toBe(1400);

    const line = summarizeRun(run!);
    expect(line).toContain('boot 800ms');
    expect(line).toContain('(model 1400ms)');
    expect(line).toContain('total 4000ms');
  });

  it("a 'ready' event does not get counted as the first substantive event", () => {
    if (!ledger.isAvailable()) return;
    const taskId = 'swarm-test-2';
    append({ taskId, phase: 'spawned', agentType: 'BiMax' });
    append({ taskId, phase: 'ready', ms: 500 });
    // no first_event / tool_call before settle (agent answered from the model with no tools)
    append({ taskId, phase: 'settled', outcome: 'done', ms: 1800, toolCalls: 0 });

    const run = foldSubagentRuns(ledger).find(r => r.taskId === taskId)!;
    expect(run.msToReady).toBe(500);
    expect(run.msToFirstEvent).toBeUndefined(); // ready must NOT have populated it
    expect(run.toolCalls).toBe(0);
  });
});
