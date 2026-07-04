import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLedger } from '../mind/event.ledger';

describe('EventLedger (v2 D1 minimal — SQLite, append-only, hash-chained)', () => {
  let dir: string;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-ledger-'));
    ledger = new EventLedger(dir);
  });
  afterEach(() => {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is available on this Node (node:sqlite) and creates .bimax/ledger.db', () => {
    expect(ledger.isAvailable()).toBe(true);
    expect(fs.existsSync(path.join(dir, '.bimax', 'ledger.db'))).toBe(true);
  });

  it('appends events and reads them back in order with payloads intact', () => {
    ledger.append('tool_outcome', { tool: 'EditFileTool', domain: 'ts', status: 'ok' });
    ledger.append('tool_outcome', { tool: 'BashTool', domain: 'tsc', status: 'ok', exitCode: 2 });
    ledger.append('evidence', { command: 'npx tsc --noEmit', ok: false });
    expect(ledger.count()).toBe(3);
    const tail = ledger.tail(10);
    expect(tail.map(e => e.type)).toEqual(['tool_outcome', 'tool_outcome', 'evidence']);
    expect(tail[1].payload.exitCode).toBe(2);
    expect(ledger.countByType()).toEqual({ tool_outcome: 2, evidence: 1 });
  });

  it('hash chain verifies clean and detects retroactive tampering', () => {
    for (let i = 0; i < 5; i++) ledger.append('tool_outcome', { i });
    expect(ledger.verifyChain()).toEqual({ ok: true, events: 5, brokenAt: null });

    // Tamper with event #3 behind the ledger's back — verification must break AT it.
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(path.join(dir, '.bimax', 'ledger.db'));
    raw.prepare("UPDATE events SET payload = '{\"i\":999}' WHERE id = 3").run();
    raw.close();
    const v = ledger.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(3);
  });

  it('the chain stays consistent across ledger instances (prev hash read from the DB, not memory)', () => {
    ledger.append('a', { n: 1 });
    ledger.close();
    const second = new EventLedger(dir);
    second.append('b', { n: 2 });
    expect(second.verifyChain().ok).toBe(true);
    expect(second.count()).toBe(2);
    second.close();
    ledger = new EventLedger(dir); // so afterEach close() has a live instance
  });

  it('append never throws even after close (best-effort recording)', () => {
    ledger.close();
    expect(() => ledger.append('x', {})).not.toThrow();
    expect(ledger.count()).toBe(0);
    expect(ledger.tail()).toEqual([]);
    expect(ledger.verifyChain().ok).toBe(true);
  });
});
