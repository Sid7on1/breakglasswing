import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLedger } from '../mind/event.ledger';
import { dateKeyOf, journalDigest, summarizeDay, journalPreloadBlock } from '../mind/daily.journal';

// PR4 — the daily journal is a pure projection of the event ledger. Build an isolated ledger,
// append tool_outcome + subagent events at known timestamps, assert the fold + preload block.
describe('daily journal — ledger projection', () => {
  let dir: string;
  let ledger: EventLedger;
  const NOW = new Date('2026-07-11T12:00:00').getTime();
  const YESTERDAY = NOW - 86_400_000;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-daily-'));
    ledger = new EventLedger(dir);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('folds a day into edits / bash / errors / files', () => {
    if (!ledger.isAvailable()) { console.warn('node:sqlite unavailable — skipping'); return; }
    // NOTE: EventLedger stamps ts = Date.now() itself, so this test asserts the fold over "today".
    ledger.append('tool_outcome', { tool: 'EditFileTool', file: '/p/user.model.ts', isError: false });
    ledger.append('tool_outcome', { tool: 'EditFileTool', file: '/p/user.model.ts', isError: false });
    ledger.append('tool_outcome', { tool: 'WriteFileTool', file: '/p/daily.journal.ts', isError: false });
    ledger.append('tool_outcome', { tool: 'BashTool', cmd: 'npm run build', isError: false });
    ledger.append('tool_outcome', { tool: 'BashTool', cmd: 'npx jest', isError: true });
    ledger.append('subagent', { taskId: 't1', phase: 'spawned' });

    const today = dateKeyOf(Date.now());
    const d = journalDigest(today, ledger);
    expect(d.edits).toBe(3);          // 2 EditFile + 1 WriteFile, all success
    expect(d.bash).toBe(2);
    expect(d.errors).toBe(1);
    expect(d.subagents).toBe(1);
    expect(d.files).toEqual(['/p/user.model.ts', '/p/daily.journal.ts']); // most-touched first
    expect(d.topTools[0]).toMatch(/EditFileTool×2|BashTool×2/);

    const line = summarizeDay(d);
    expect(line).toContain('3 edit(s) across 2 file(s)');
    expect(line).toContain('user.model.ts');
    expect(line).toContain('1 error(s)');
  });

  it('preload block names today and is empty for an idle future day', () => {
    if (!ledger.isAvailable()) return;
    const block = journalPreloadBlock(Date.now(), ledger);
    expect(block).toContain('RECENT WORK');
    expect(block).toContain('Today:');

    // A day with no events → empty digest → empty summary.
    expect(summarizeDay(journalDigest('2020-01-01', ledger))).toBeNull();
  });

  it('dateKeyOf uses local calendar days', () => {
    expect(dateKeyOf(NOW)).toBe('2026-07-11');
    expect(dateKeyOf(YESTERDAY)).toBe('2026-07-10');
  });
});
