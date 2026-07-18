import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ExecutionLedger, LEDGER_SCHEMA_VERSION, redactForLedger, __resetExecutionLedgerForTests,
} from '../core/execution.ledger';

// §7 mandate coverage: reconstruction by folding, corruption recovery (line + whole-file),
// schema-version forward-compat skip, redaction + bounded strings, retention/compaction,
// crash-recovery candidates (interruptedTasks), user cleanup (clearCompleted).

describe('ExecutionLedger', () => {
  let dir: string;
  let ledger: ExecutionLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-ledger-'));
    ledger = new ExecutionLedger(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reconstructs task state by folding created + transitions', () => {
    ledger.append({ taskId: 't1', type: 'created', kind: 'shell', title: 'build it', command: 'make', cwd: '/tmp/x' });
    ledger.append({ taskId: 't1', type: 'transition', state: 'starting' });
    ledger.append({ taskId: 't1', type: 'transition', state: 'running' });
    ledger.append({ taskId: 't1', type: 'transition', state: 'completed' });
    const [t] = ledger.reconstruct();
    expect(t.taskId).toBe('t1');
    expect(t.state).toBe('completed');
    expect(t.resumable).toBe(true); // command + cwd recorded
  });

  test('resumable is false without a recorded command+cwd — never fake resumability', () => {
    ledger.append({ taskId: 'b1', type: 'created', kind: 'browser', title: 'browser session' });
    ledger.append({ taskId: 'b1', type: 'transition', state: 'running' });
    const [t] = ledger.reconstruct();
    expect(t.resumable).toBe(false);
  });

  test('interruptedTasks returns only non-terminal tasks (crash-recovery candidates)', () => {
    ledger.append({ taskId: 'a', type: 'created', kind: 'shell', title: 'a', command: 'sleep 5', cwd: '/tmp' });
    ledger.append({ taskId: 'a', type: 'transition', state: 'running' });
    ledger.append({ taskId: 'b', type: 'created', kind: 'shell', title: 'b', command: 'ls', cwd: '/tmp' });
    ledger.append({ taskId: 'b', type: 'transition', state: 'completed' });
    const interrupted = ledger.interruptedTasks();
    expect(interrupted.map(t => t.taskId)).toEqual(['a']);
  });

  test('retry records fold into a retry count; failure reason captured', () => {
    ledger.append({ taskId: 'r1', type: 'created', kind: 'shell', title: 'flaky', command: 'x', cwd: '/tmp' });
    ledger.append({ taskId: 'r1', type: 'retry', attempt: 1 });
    ledger.append({ taskId: 'r1', type: 'retry', attempt: 2 });
    ledger.append({ taskId: 'r1', type: 'transition', state: 'failed-resumable', reason: 'exit 1' });
    const [t] = ledger.reconstruct();
    expect(t.retries).toBe(2);
    expect(t.failureReason).toBe('exit 1');
  });

  test('corrupt lines are skipped without losing valid records', () => {
    ledger.append({ taskId: 'ok', type: 'created', kind: 'shell', title: 'ok', command: 'ls', cwd: '/tmp' });
    fs.appendFileSync(ledger.filePath, '{"broken json\nnot json at all\n', 'utf-8');
    ledger.append({ taskId: 'ok', type: 'transition', state: 'running' });
    const records = ledger.readAll();
    expect(records).toHaveLength(2);
    expect(ledger.reconstruct()[0].state).toBe('running');
  });

  test('a wholly unreadable file is preserved aside and treated as empty', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ledger.filePath, 'garbage\x00binary\nmore garbage\n', 'utf-8');
    expect(ledger.readAll()).toEqual([]);
    const preserved = fs.readdirSync(dir).filter(f => f.includes('.corrupt-'));
    expect(preserved).toHaveLength(1); // evidence preserved, never silently destroyed
    expect(fs.existsSync(ledger.filePath)).toBe(false);
  });

  test('records with a NEWER schema version are skipped, older/current kept', () => {
    ledger.append({ taskId: 'cur', type: 'created', kind: 'shell', title: 'cur', command: 'ls', cwd: '/tmp' });
    fs.appendFileSync(ledger.filePath, JSON.stringify({
      v: LEDGER_SCHEMA_VERSION + 1, ts: Date.now(), taskId: 'future', type: 'created', title: 'from-the-future',
    }) + '\n', 'utf-8');
    const records = ledger.readAll();
    expect(records.map(r => r.taskId)).toEqual(['cur']);
  });

  test('redaction: sensitive keys and credential-shaped values never reach disk', () => {
    ledger.append({
      taskId: 's1', type: 'created', kind: 'shell', title: 'deploy',
      command: 'curl -H "auth: nvapi-abc123def456ghi789"', cwd: '/tmp',
      data: { apiKey: 'super-secret', nested: { token: 'x', fine: 'keep-me' }, value: 'nvapi-abcdefgh12345678' },
    } as any);
    const raw = fs.readFileSync(ledger.filePath, 'utf-8');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('nvapi-abc');
    expect(raw).toContain('keep-me');
    expect(raw).toContain('[redacted]');
  });

  test('redaction bounds string sizes (large-output exclusion)', () => {
    const huge = 'x'.repeat(10_000);
    const out = redactForLedger({ note: huge });
    expect((out.note as string).length).toBeLessThan(3000);
    expect(out.note).toContain('[truncated]');
  });

  test('clearCompleted drops terminal tasks, keeps interrupted ones', () => {
    ledger.append({ taskId: 'live', type: 'created', kind: 'shell', title: 'live', command: 'sleep 9', cwd: '/tmp' });
    ledger.append({ taskId: 'live', type: 'transition', state: 'running' });
    ledger.append({ taskId: 'done', type: 'created', kind: 'shell', title: 'done', command: 'ls', cwd: '/tmp' });
    ledger.append({ taskId: 'done', type: 'transition', state: 'completed' });
    const dropped = ledger.clearCompleted();
    expect(dropped).toBe(2); // both 'done' records gone
    expect(ledger.reconstruct().map(t => t.taskId)).toEqual(['live']);
  });

  test('bounded retention: file compacts once past the size budget, live tasks survive', () => {
    // A live task created early — must survive compaction even though it is old data.
    ledger.append({ taskId: 'keepme', type: 'created', kind: 'shell', title: 'keep', command: 'sleep 99', cwd: '/tmp' });
    ledger.append({ taskId: 'keepme', type: 'transition', state: 'running' });
    // Flood with completed-task records until the file crosses 512KB.
    const pad = 'p'.repeat(1500);
    for (let i = 0; i < 400; i++) {
      ledger.append({ taskId: `bulk${i}`, type: 'created', kind: 'shell', title: 'bulk', command: 'ls', cwd: '/tmp', data: { pad } });
      ledger.append({ taskId: `bulk${i}`, type: 'transition', state: 'completed' });
    }
    const size = fs.statSync(ledger.filePath).size;
    expect(size).toBeLessThan(1024 * 1024); // compaction kicked in — file is bounded
    const tasks = ledger.reconstruct();
    expect(tasks.find(t => t.taskId === 'keepme')?.state).toBe('running'); // live task retained in full
  });

  test('append never throws even when the directory is unwritable', () => {
    const ro = new ExecutionLedger('/nonexistent-root-path/nope');
    expect(() => ro.append({ taskId: 'x', type: 'created', title: 'x' })).not.toThrow();
    expect(ro.readAll()).toEqual([]);
  });

  test('__resetExecutionLedgerForTests points the singleton at a fresh dir', () => {
    const l = __resetExecutionLedgerForTests(dir);
    l.append({ taskId: 'sing', type: 'created', title: 'singleton' });
    expect(l.filePath.startsWith(dir)).toBe(true);
  });
});
