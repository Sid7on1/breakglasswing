import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EpistemicLedger } from '../mind/epistemic.ledger';
import { EventLedger } from '../mind/event.ledger';

// Frozen S2 Unknown: "behavior on a corrupted ledger not verified." Both ledgers carry recovery
// code (epistemic load() try/catch + shape validation; event ledger try/catch + isAvailable gate);
// these lock that a corrupt on-disk ledger degrades gracefully instead of crashing the agent.

function mkRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-ledrec-'));
  fs.mkdirSync(path.join(root, '.bimax'), { recursive: true });
  return root;
}

describe('epistemic ledger — corrupt file recovery', () => {
  it('recovers from non-JSON garbage to a clean default (no throw)', () => {
    const root = mkRoot();
    fs.writeFileSync(path.join(root, '.bimax', 'epistemic.json'), '{not valid json at all', 'utf-8');
    const led = new EpistemicLedger(root);
    expect(() => led.stats()).not.toThrow();
    expect(led.calibration()).toEqual([]);
    expect(led.stats().resolved).toBe(0);
    // …and it is still usable afterwards: a fresh claim resolves and lands in a bucket.
    led.openClaim('ts', 0.9, 'src/x.ts');
    expect(() => led.resolve(true, { command: 'npm run build', output: 'ok' })).not.toThrow();
  });

  it('recovers from valid JSON with the wrong shape', () => {
    const root = mkRoot();
    // buckets must be length-10; this malformed shape must be rejected, not adopted.
    fs.writeFileSync(path.join(root, '.bimax', 'epistemic.json'), JSON.stringify({ open: [], buckets: [1, 2, 3] }), 'utf-8');
    const led = new EpistemicLedger(root);
    expect(led.stats().resolved).toBe(0);
    expect(led.calibration()).toEqual([]);
  });
});

describe('event ledger — corrupt db degrades gracefully', () => {
  it('a garbage ledger.db yields an unavailable, no-throw ledger', () => {
    const root = mkRoot();
    // Not a valid SQLite file — opening / first exec must be caught, leaving a no-op ledger.
    fs.writeFileSync(path.join(root, '.bimax', 'ledger.db'), Buffer.from('this is not a sqlite database'), 'utf-8');
    let led: EventLedger;
    expect(() => { led = new EventLedger(root); }).not.toThrow();
    expect(led!.isAvailable()).toBe(false);
    // Recording is strictly best-effort — it never throws even when unavailable.
    expect(() => led!.append('tool_outcome', { ok: true })).not.toThrow();
    expect(() => led!.countByType()).not.toThrow();
  });
});
