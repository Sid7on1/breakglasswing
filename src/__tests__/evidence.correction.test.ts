// Phase 8 completion — reversible correction (V28B, S28-C).
//
// Journeys from docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §11:
//   S28-07 correction fails halfway → before-state restored and independently verified
//   S28-08 dirty repository correction → unrelated user changes survive byte-for-byte
// and the slice exit: "mutation testing proves a fake repair cannot pass when end state is wrong".

import {
  Correction, CorrectionHost, CorrectionPreview, conflictsWithDirtyWork, correctionStaysInProject,
} from '../evidence/correction';
import { EvidenceLedger } from '../evidence/ledger';
import { validate } from '../evidence/schema';

const HOME = '/Users/dev';
const PROJECT = '/Users/dev/work/app';
const LOCKFILE = `${PROJECT}/package-lock.json`;

/** An in-memory filesystem that records every write, so "touched nothing else" is checkable. */
class FakeHost implements CorrectionHost {
  writes: string[] = [];
  removes: string[] = [];
  constructor(public files: Record<string, string | null> = {}) {}
  async read(path: string) { return this.files[path] ?? null; }
  async write(path: string, contents: string) { this.writes.push(path); this.files[path] = contents; }
  async remove(path: string) { this.removes.push(path); this.files[path] = null; }
}

const preview = (over: Partial<CorrectionPreview> = {}): CorrectionPreview => ({
  correctionClass: 'project',
  summary: 'restore the lockfile the postinstall script rewrote',
  paths: [LOCKFILE],
  changes: [{ path: LOCKFILE, from: 'tampered', to: 'original' }],
  nonReversibleImpact: [],
  postcondition: 'the lockfile matches the digest recorded at the start of the task',
  ...over,
});

const correctionFor = (host: FakeHost, ledger = new EvidenceLedger()) => new Correction(
  ledger, 'task_1', 'op_1', host,
  { home: HOME, projectRoot: PROJECT, now: (() => { let t = 1_000; return () => (t += 10); })() },
);

const walkToPrecondition = async (host: FakeHost, ledger = new EvidenceLedger(), p = preview()) => {
  const correction = correctionFor(host, ledger);
  expect(correction.propose(p).ok).toBe(true);
  expect((await correction.captureSnapshot()).ok).toBe(true);
  expect(correction.approve(p, 'user').ok).toBe(true);
  expect((await correction.checkPreconditions()).ok).toBe(true);
  return correction;
};

const satisfiedProbe = async () => ({ satisfied: true, detail: 'the lockfile matches', freshnessMs: 0 });

describe('a correction is bounded before it is allowed to exist', () => {
  it('refuses a correction that names no path', () => {
    const correction = correctionFor(new FakeHost());
    expect(correction.propose(preview({ paths: [] })).ok).toBe(false);
  });

  it('refuses a correction with no declared postcondition', () => {
    const correction = correctionFor(new FakeHost());
    expect(correction.propose(preview({ postcondition: '  ' })).detail).toContain('postcondition');
  });

  it.each([
    ['a credential store', `${HOME}/.ssh/id_ed25519`],
    ['a persistence path', '/Library/LaunchDaemons/x.plist'],
    ['a security setting', '/Library/Application Support/com.apple.TCC/TCC.db'],
    ['a system path', '/System/Library/x'],
  ])('refuses to mutate %s — Bimax explains those, it does not change them', (_label, path) => {
    const correction = correctionFor(new FakeHost());
    const result = correction.propose(preview({ paths: [path] }));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('it does not change them');
  });

  it('refuses a macOS recommendation that names paths to mutate', () => {
    const correction = correctionFor(new FakeHost());
    expect(correction.propose(preview({ correctionClass: 'macos-recommendation' })).ok).toBe(false);
  });

  it('accepts a macOS recommendation that mutates nothing', () => {
    const correction = correctionFor(new FakeHost());
    expect(correction.propose(preview({
      correctionClass: 'macos-recommendation', paths: [], changes: [],
      postcondition: 'the user opened the Privacy pane',
    })).ok).toBe(true);
  });

  it('refuses an approval that is not the correction that would be applied', async () => {
    const host = new FakeHost({ [LOCKFILE]: 'tampered' });
    const correction = correctionFor(host);
    correction.propose(preview());
    await correction.captureSnapshot();
    const result = correction.approve(preview({ summary: 'something else' }), 'user');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not the correction that would be applied');
  });

  it('refuses to apply without a snapshot', async () => {
    const correction = correctionFor(new FakeHost());
    correction.propose(preview());
    const result = await correction.apply(async () => ({ ok: true, touched: [LOCKFILE], detail: 'x' }), satisfiedProbe);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('out of order');
  });

  it('refuses when a previewed path changed between snapshot and application', async () => {
    const host = new FakeHost({ [LOCKFILE]: 'tampered' });
    const correction = correctionFor(host);
    correction.propose(preview());
    await correction.captureSnapshot();
    correction.approve(preview(), 'user');
    host.files[LOCKFILE] = 'someone else edited it';
    const result = await correction.checkPreconditions();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no longer describes reality');
  });
});

describe('a successful correction commits on an independently observed end state', () => {
  it('applies, verifies and commits', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'tampered' });
    const correction = await walkToPrecondition(host, ledger);
    const result = await correction.apply(
      async () => { host.files[LOCKFILE] = 'original'; return { ok: true, touched: [LOCKFILE], detail: 'restored' }; },
      satisfiedProbe,
    );
    expect(result.ok).toBe(true);
    expect(result.step).toBe('committed');
    expect(host.files[LOCKFILE]).toBe('original');
    for (const entry of ledger.all()) expect(validate(entry).ok).toBe(true);
    expect(ledger.ofKind('Rollback')).toHaveLength(0);
  });

  it('produces a verification the schema accepts as satisfied', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'tampered' });
    const correction = await walkToPrecondition(host, ledger);
    await correction.apply(async () => ({ ok: true, touched: [LOCKFILE], detail: 'restored' }), satisfiedProbe);
    const verification = ledger.ofKind('Verification')[0];
    expect(verification.satisfied).toBe(true);
    expect(verification.basis).toBe('observed');
  });
});

describe('S28-07 — a correction that fails halfway restores and independently verifies the before state', () => {
  it('rolls back when the mutation throws', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'original' });
    const correction = await walkToPrecondition(host, ledger);
    const result = await correction.apply(
      async () => { host.files[LOCKFILE] = 'half-written'; throw new Error('disk full'); },
      satisfiedProbe,
    );
    expect(result.ok).toBe(false);
    expect(result.step).toBe('rolled-back');
    expect(host.files[LOCKFILE]).toBe('original');
    const rollback = ledger.ofKind('Rollback')[0];
    expect(rollback.result).toBe('restored');
    expect(rollback.verificationId).not.toBeNull();
  });

  it('rolls back when the postcondition is not satisfied', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'original' });
    const correction = await walkToPrecondition(host, ledger);
    const result = await correction.apply(
      async () => { host.files[LOCKFILE] = 'wrong'; return { ok: true, touched: [LOCKFILE], detail: 'wrote' }; },
      async () => ({ satisfied: false, detail: 'the digest still does not match', freshnessMs: 0 }),
    );
    expect(result.ok).toBe(false);
    expect(host.files[LOCKFILE]).toBe('original');
    expect(ledger.ofKind('Rollback')[0].result).toBe('restored');
  });

  it('rolls back when the postcondition cannot be established on fresh evidence (the fake repair)', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'original' });
    const correction = await walkToPrecondition(host, ledger);
    const result = await correction.apply(
      async () => { host.files[LOCKFILE] = 'claimed-fixed'; return { ok: true, touched: [LOCKFILE], detail: 'wrote' }; },
      // The probe says yes, but its evidence is far past the freshness budget: "we cannot tell".
      async () => ({ satisfied: true, detail: 'looked right a minute ago', freshnessMs: 60_000 }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('could not be established');
    expect(host.files[LOCKFILE]).toBe('original');
    expect(ledger.ofKind('Verification')[0].satisfied).toBeNull();
  });

  it('rolls back a mutation that strayed outside its preview, even when it reports success', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'original', [`${PROJECT}/src/a.ts`]: 'user code' });
    const correction = await walkToPrecondition(host, ledger);
    const result = await correction.apply(
      async () => ({ ok: true, touched: [LOCKFILE, `${PROJECT}/src/a.ts`], detail: 'also tidied a file' }),
      satisfiedProbe,
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('exceeded its preview');
    // The rollback only restores what it snapshotted; the strayed file is never written by the
    // correction machinery, which is what keeps the blast radius bounded in both directions.
    expect(host.writes).toEqual([LOCKFILE]);
  });

  it('reports a rollback that did not fully take as partial rather than restored', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({ [LOCKFILE]: 'original' });
    const correction = await walkToPrecondition(host, ledger);
    host.write = async (path: string) => { host.writes.push(path); throw new Error('read-only filesystem'); };
    const result = await correction.apply(
      async () => ({ ok: false, touched: [LOCKFILE], detail: 'could not write' }),
      satisfiedProbe,
    );
    expect(result.ok).toBe(false);
    const rollback = ledger.ofKind('Rollback')[0];
    expect(rollback.result).toBe('failed');
    const verification = ledger.all().find(r => r.kind === 'Verification' && r.id === rollback.verificationId);
    expect(verification && verification.kind === 'Verification' && verification.satisfied).toBe(false);
  });

  it('deletes a file the correction created, when it did not exist at snapshot time', async () => {
    const ledger = new EvidenceLedger();
    const host = new FakeHost({});
    const created = `${PROJECT}/generated.json`;
    const correction = await walkToPrecondition(host, ledger, preview({ paths: [created], changes: [] }));
    await correction.apply(
      async () => { host.files[created] = 'new'; return { ok: true, touched: [created], detail: 'created' }; },
      async () => ({ satisfied: false, detail: 'not what was wanted', freshnessMs: 0 }),
    );
    expect(host.removes).toEqual([created]);
    expect(host.files[created]).toBeNull();
  });
});

describe('S28-08 — a dirty repository survives a correction byte-for-byte', () => {
  it('writes only the previewed path, whatever else is dirty', async () => {
    const host = new FakeHost({
      [LOCKFILE]: 'original',
      [`${PROJECT}/src/a.ts`]: 'user work in progress',
      [`${PROJECT}/src/b.ts`]: 'more user work',
    });
    const before = { ...host.files };
    const correction = await walkToPrecondition(host, new EvidenceLedger());
    await correction.apply(
      async () => { host.files[LOCKFILE] = 'restored'; return { ok: true, touched: [LOCKFILE], detail: 'ok' }; },
      satisfiedProbe,
    );
    expect(host.files[`${PROJECT}/src/a.ts`]).toBe(before[`${PROJECT}/src/a.ts`]);
    expect(host.files[`${PROJECT}/src/b.ts`]).toBe(before[`${PROJECT}/src/b.ts`]);
    expect(host.writes).toEqual([]);
    expect(host.removes).toEqual([]);
  });

  it('restores only the previewed path after a failure, leaving dirty work untouched', async () => {
    const host = new FakeHost({ [LOCKFILE]: 'original', [`${PROJECT}/src/a.ts`]: 'user work' });
    const correction = await walkToPrecondition(host, new EvidenceLedger());
    await correction.apply(
      async () => { throw new Error('boom'); },
      satisfiedProbe,
    );
    expect(host.writes).toEqual([LOCKFILE]);
    expect(host.files[`${PROJECT}/src/a.ts`]).toBe('user work');
  });

  it('names the dirty paths a correction would collide with, before it runs', () => {
    expect(conflictsWithDirtyWork(preview(), [`${PROJECT}/src/a.ts`])).toEqual([]);
    expect(conflictsWithDirtyWork(preview(), [LOCKFILE, `${PROJECT}/src/a.ts`])).toEqual([LOCKFILE]);
  });

  it('knows when a correction would reach outside the project', () => {
    expect(correctionStaysInProject(preview(), PROJECT)).toBe(true);
    expect(correctionStaysInProject(preview({ paths: [`${HOME}/Documents/x`] }), PROJECT)).toBe(false);
  });
});
