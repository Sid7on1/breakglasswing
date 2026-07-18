import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __resetExecutionLedgerForTests } from '../core/execution.ledger';
import { TaskRegistry, __resetTaskRegistryForTests } from '../core/task.registry';

// §6 mandate coverage: 16-state machine with a validated transition map, honest capabilities
// (pause refused where no real suspend exists), bounded output ring, attention semantics,
// close-only-terminal, prefix lookup, and every transition landing in the execution ledger.

describe('TaskRegistry', () => {
  let dir: string;
  let reg: TaskRegistry;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-reg-'));
    __resetExecutionLedgerForTests(dir);
    reg = __resetTaskRegistryForTests();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('legal lifecycle: queued → starting → running → completed', () => {
    const t = reg.create({ kind: 'shell', title: 'build', command: 'make', cwd: '/tmp' });
    expect(t.state).toBe('queued');
    expect(reg.transition(t.id, 'starting')).toBe(true);
    expect(reg.transition(t.id, 'running')).toBe(true);
    expect(reg.get(t.id)!.startedAt).toBeDefined();
    expect(reg.transition(t.id, 'completed')).toBe(true);
    expect(reg.get(t.id)!.endedAt).toBeDefined();
  });

  test('illegal transitions are refused, state unchanged', () => {
    const t = reg.create({ kind: 'shell', title: 'x' });
    expect(reg.transition(t.id, 'completed')).toBe(false); // queued → completed is not legal
    expect(reg.get(t.id)!.state).toBe('queued');
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    reg.transition(t.id, 'completed');
    expect(reg.transition(t.id, 'running')).toBe(false); // terminal states are terminal
    expect(reg.get(t.id)!.state).toBe('completed');
  });

  test('failed-resumable → retrying is the one legal exit from failure', () => {
    const t = reg.create({ kind: 'shell', title: 'x', command: 'ls', cwd: '/tmp' });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    reg.transition(t.id, 'failed-resumable', 'exit 1');
    expect(reg.get(t.id)!.failure).toBe('exit 1');
    expect(reg.transition(t.id, 'retrying')).toBe(true);
    expect(reg.transition(t.id, 'running')).toBe(true);
  });

  test('honest pause: refused with a reason when no real suspend handle exists', () => {
    const t = reg.create({ kind: 'browser', title: 'browser session', supports: { cancel: true, pause: false } });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    const result = reg.pause(t.id);
    expect(result).toContain("can't pause");
    expect(reg.get(t.id)!.state).toBe('running'); // never faked a paused state
  });

  test('real pause/resume goes through the handle and the paused state', () => {
    let stopped = 0, resumed = 0;
    const t = reg.create({
      kind: 'shell', title: 'long job', command: 'sleep 99', cwd: '/tmp',
      handle: { cancel: () => { }, pause: () => { stopped++; }, resume: () => { resumed++; } },
    });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    expect(reg.pause(t.id)).toContain('Paused');
    expect(stopped).toBe(1);
    expect(reg.get(t.id)!.state).toBe('paused');
    expect(reg.resume(t.id)).toContain('Resumed');
    expect(resumed).toBe(1);
    expect(reg.get(t.id)!.state).toBe('running');
  });

  test('cancel invokes the handle and moves through cancelling', () => {
    let killed = 0;
    const t = reg.create({ kind: 'shell', title: 'x', handle: { cancel: () => { killed++; } } });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    expect(reg.cancel(t.id)).toContain('Cancelling');
    expect(killed).toBe(1);
    expect(reg.get(t.id)!.state).toBe('cancelling');
    reg.transition(t.id, 'cancelled');
    expect(reg.cancel(t.id)).toContain('already cancelled');
  });

  test('terminal transition drops the process handle — no dead handles retained', () => {
    let killed = 0;
    const t = reg.create({ kind: 'shell', title: 'x', handle: { cancel: () => { killed++; } } });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    reg.transition(t.id, 'completed');
    reg.cancel(t.id); // refused: already terminal
    expect(killed).toBe(0);
  });

  test('output ring buffer is bounded at OUTPUT_MAX_LINES', () => {
    const t = reg.create({ kind: 'shell', title: 'chatty' });
    for (let i = 0; i < 1000; i++) reg.appendOutput(t.id, `line ${i}`);
    const tail = reg.output(t.id, 10_000).split('\n');
    expect(tail.length).toBe(TaskRegistry.OUTPUT_MAX_LINES);
    expect(tail[tail.length - 1]).toBe('line 999'); // newest kept, oldest dropped
    expect(tail[0]).toBe(`line ${1000 - TaskRegistry.OUTPUT_MAX_LINES}`);
  });

  test('very long output lines are truncated per line', () => {
    const t = reg.create({ kind: 'shell', title: 'x' });
    reg.appendOutput(t.id, 'y'.repeat(2000));
    expect(reg.output(t.id).length).toBeLessThan(600);
  });

  test('attention: failed and waiting-user set it; seen() clears it', () => {
    const t = reg.create({ kind: 'shell', title: 'x' });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    reg.transition(t.id, 'waiting-user', 'needs approval');
    expect(reg.get(t.id)!.attention).toBe(true);
    reg.seen(t.id);
    expect(reg.get(t.id)!.attention).toBe(false);
  });

  test('fast completions do not demand attention; only long tasks announce', () => {
    const t = reg.create({ kind: 'shell', title: 'quick' });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    reg.transition(t.id, 'completed');
    expect(reg.get(t.id)!.attention).toBe(false);
  });

  test('close removes only terminal tasks; live work must be cancelled first', () => {
    const t = reg.create({ kind: 'shell', title: 'x' });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    expect(reg.close(t.id)).toContain('still running');
    expect(reg.get(t.id)).toBeDefined();
    reg.transition(t.id, 'completed');
    expect(reg.close(t.id)).toContain('Closed');
    expect(reg.get(t.id)).toBeUndefined();
    expect(reg.output(t.id)).toBe(''); // output buffer freed too
  });

  test('find matches unambiguous prefixes only', () => {
    const a = reg.create({ kind: 'shell', title: 'a' });
    expect(reg.find(a.id.slice(0, 6))?.id).toBe(a.id);
    expect(reg.find('tk-')?.id).toBe(a.id); // unambiguous while it is the only task
    reg.create({ kind: 'shell', title: 'b' });
    expect(reg.find('tk-')).toBeUndefined(); // now ambiguous → refuse to guess
  });

  test('list puts pinned tasks first', () => {
    const a = reg.create({ kind: 'shell', title: 'a' });
    const b = reg.create({ kind: 'shell', title: 'b' });
    reg.pin(a.id);
    expect(reg.list()[0].id).toBe(a.id);
    expect(reg.list()[1].id).toBe(b.id);
  });

  test('every transition lands in the execution ledger (crash-recoverable)', () => {
    const { getExecutionLedger } = require('../core/execution.ledger') as typeof import('../core/execution.ledger');
    const t = reg.create({ kind: 'shell', title: 'durable', command: 'make', cwd: '/tmp' });
    reg.transition(t.id, 'starting');
    reg.transition(t.id, 'running');
    const rebuilt = getExecutionLedger().reconstruct().find(r => r.taskId === t.id);
    expect(rebuilt?.state).toBe('running');
    expect(rebuilt?.resumable).toBe(true);
  });
});
