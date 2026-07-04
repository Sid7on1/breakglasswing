import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { MutationEngine, OPERATORS, mulberry32, findFunctions } from '../mind/mutation.engine';
import { getEventLedger, EventLedger, __setEventLedger } from '../mind/event.ledger';

// Every test seeds/counts dream_episode events; a SHARED ledger would leak one test's
// curriculum into another's IRT activation count (n≥100 is a GLOBAL threshold).
beforeEach(() => {
  __setEventLedger(new EventLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-mutled-'))));
});

const op = (id: string) => OPERATORS.find(o => o.id === id)!;

/** A tmp git repo with one source file that has a convention-covering test. */
function fixtureRepo(): { root: string; srcPath: string; pristine: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-mut-'));
  fs.mkdirSync(path.join(root, 'src'));
  const pristine = [
    'export function isZero(n: number): boolean {',
    '  if (n === 0) {',
    '    return true;',
    '  }',
    '  return false;',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'src', 'calc.ts'), pristine);
  fs.writeFileSync(path.join(root, 'src', 'calc.test.ts'), '// covers calc.ts by convention\n');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'dream@bimax.test']);
  git(['config', 'user.name', 'bimax-dream']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);
  return { root, srcPath: path.join(root, 'src', 'calc.ts'), pristine };
}

/** Kill-check stand-in: "tests pass" iff the worktree's calc.ts matches the pristine source. */
function pristineCheck(pristine: string) {
  return (worktree: string) => {
    const now = fs.readFileSync(path.join(worktree, 'src', 'calc.ts'), 'utf-8');
    return { ok: now === pristine, output: now === pristine ? 'PASS' : 'FAIL calc.test.ts' };
  };
}

describe('MutationEngine (dream v2 — self-play with known ground truth)', () => {
  const cleanups: string[] = [];
  afterAll(() => {
    for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  });

  it('operators mutate eligible lines and decline ineligible ones', () => {
    expect(op('negate-equality').apply('if (a === b) {')).toBe('if (a !== b) {');
    expect(op('negate-equality').apply('if (a !== b) {')).toBe('if (a === b) {');
    expect(op('boundary').apply('for (let i = 0; i < n; i++) {')).toBe('for (let i = 0; i <= n; i++) {');
    expect(op('boundary').apply('const x: Map<string, number> = m;')).toBeNull(); // generics untouched
    expect(op('logic-swap').apply('if (a && b) return;')).toBe('if (a || b) return;');
    expect(op('off-by-one').apply('return arr[len - 1];')).toBe('return arr[len + 1];');
    expect(op('bool-const').apply('return true;')).toBe('return false;');
    expect(op('bool-const').apply('return count;')).toBeNull();
  });

  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42); const b = mulberry32(42); const c = mulberry32(43);
    const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).not.toBe(c());
  });

  it('finds candidates only where a convention test covers the source', () => {
    const { root } = fixtureRepo();
    cleanups.push(root);
    fs.writeFileSync(path.join(root, 'src', 'lonely.ts'), 'export const y = 2;\n');
    const engine = new MutationEngine(root, { seed: 1 });
    const cands = engine.findCandidates();
    expect(cands).toEqual([{ file: path.join('src', 'calc.ts'), testFile: path.join('src', 'calc.test.ts') }]);
  });

  it('full episode: plant → killed → sandboxed fix → objective grade → exemplar (perfect agent)', async () => {
    const { root, pristine } = fixtureRepo();
    cleanups.push(root);
    const before = getEventLedger().byType('dream_episode').length;

    const engine = new MutationEngine(root, {
      seed: 7,
      runCheck: pristineCheck(pristine),
      attemptFix: async (worktree) => {
        // A perfect agent: diagnoses and restores the ground truth exactly.
        fs.writeFileSync(path.join(worktree, 'src', 'calc.ts'), pristine);
      },
    });
    const report = await engine.selfPlay();

    expect(report.attempted).toBe(true);
    expect(report.killed).toBe(true);
    expect(report.fixed).toBe(true);
    expect(report.exactRestore).toBe(true);
    expect(report.task?.file).toBe(path.join('src', 'calc.ts'));
    expect(getEventLedger().byType('dream_episode').length).toBe(before + 1);
    expect(engine.exemplars()).toHaveLength(1);
    expect(engine.exemplars()[0].outcome).toBe('exact');
    // Mutation fixes are never merged — worktree AND branch must be gone.
    const branches = execFileSync('git', ['branch', '--list', 'dream/mut-*'], { cwd: root, encoding: 'utf-8' });
    expect(branches.trim()).toBe('');
  });

  it('a failed fix attempt grades ✗ and records the failure event, no exemplar', async () => {
    const { root, pristine } = fixtureRepo();
    cleanups.push(root);

    const engine = new MutationEngine(root, {
      seed: 7,
      runCheck: pristineCheck(pristine),
      attemptFix: async () => { /* the agent flails and changes nothing */ },
    });
    const report = await engine.selfPlay();

    expect(report.attempted).toBe(true);
    expect(report.killed).toBe(true);
    expect(report.fixed).toBe(false);
    expect(report.exactRestore).toBeUndefined();
    expect(engine.exemplars()).toHaveLength(0);
  });

  it('mutants the tests never catch are discarded and logged as verification gaps', async () => {
    const { root } = fixtureRepo();
    cleanups.push(root);
    const beforeSurvived = getEventLedger().byType('mutant_survived').length;

    const engine = new MutationEngine(root, {
      seed: 7,
      runCheck: () => ({ ok: true, output: 'PASS (tests too weak to notice)' }),
      attemptFix: async () => { throw new Error('must never be called'); },
    });
    const report = await engine.selfPlay();

    expect(report.attempted).toBe(false);
    expect(report.survivors).toBeGreaterThanOrEqual(1);
    expect(report.note).toContain('survived');
    expect(getEventLedger().byType('mutant_survived').length).toBe(beforeSurvived + report.survivors);
  });

  it('findFunctions spans bodies by brace counting, skipping trivial and unclosed ones', () => {
    const src = [
      'export function tiny() { return 1; }',              // body < 3 lines — skipped
      'export function isZero(n: number): boolean {',
      '  if (n === 0) {',
      '    return true;',
      '  }',
      '  return false;',
      '}',
      'const arrow = () => 1;',                            // not a function declaration
    ];
    const fns = findFunctions(src, false);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('isZero');
    expect(fns[0].sigLine).toBe(2);
    expect(src.slice(fns[0].bodyStart - 1, fns[0].bodyEnd)).toEqual([
      '  if (n === 0) {', '    return true;', '  }', '  return false;',
    ]);

    const goSrc = ['func IsZero(n int) bool {', '\tif n == 0 {', '\t\treturn true', '\t}', '\treturn false', '}'];
    expect(findFunctions(goSrc, true).map(f => f.name)).toEqual(['IsZero']);
  });

  it('regeneration episode: delete the body, tests catch the stub, agent re-implements', async () => {
    const { root, pristine } = fixtureRepo();
    cleanups.push(root);

    let promptSeen = '';
    const engine = new MutationEngine(root, {
      seed: 3,
      runCheck: pristineCheck(pristine),
      attemptFix: async (worktree, prompt) => {
        promptSeen = prompt;
        // The stub must be committed — no git-diff shortcut to the deleted body.
        const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf-8' });
        expect(status.trim()).toBe('');
        fs.writeFileSync(path.join(worktree, 'src', 'calc.ts'), pristine);
      },
    });
    const report = await engine.selfPlay(undefined, { generator: 'regeneration' });

    expect(report.generator).toBe('regeneration');
    expect(report.attempted).toBe(true);
    expect(report.killed).toBe(true);
    expect(report.fixed).toBe(true);
    expect(report.exactRestore).toBe(true); // whole-file compare for regeneration
    expect(report.task?.op).toBe('regeneration');
    expect(promptSeen).toContain('isZero');
    expect(promptSeen).toContain('unimplemented');
    const ex = engine.exemplars();
    expect(ex[ex.length - 1].kind).toBe('regeneration');
  });

  it('saturation flags a plateau and recognizes an improving curve', () => {
    const ledger = getEventLedger();
    // 20 old failures then 20 recent successes → clearly improving.
    for (let i = 0; i < 20; i++) ledger.append('dream_episode', { generator: 'mutation', op: 'sat-probe', killed: true, fixed: false });
    for (let i = 0; i < 20; i++) ledger.append('dream_episode', { generator: 'mutation', op: 'sat-probe', killed: true, fixed: true });
    const improving = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-sat-'))).saturation();
    expect(improving.n).toBe(40);
    expect(improving.plateaued).toBe(false);
    expect(improving.recentRate).toBeGreaterThan(improving.priorRate);

    // 40 more successes → the last-40 window is uniformly green: no improvement left.
    for (let i = 0; i < 40; i++) ledger.append('dream_episode', { generator: 'mutation', op: 'sat-probe', killed: true, fixed: true });
    const flat = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-sat-'))).saturation();
    expect(flat.plateaued).toBe(true);
  });

  it('curriculum-lite targets the P(success)≈0.65 frontier with a 20% easy floor', () => {
    // Seed the ledger: boundary sits EXACTLY on the frontier, negate is mastered, off-by-one is hopeless.
    const ledger = getEventLedger();
    const seedEvents = (opId: string, s: number, f: number) => {
      for (let i = 0; i < s; i++) ledger.append('dream_episode', { generator: 'mutation', op: opId, killed: true, fixed: true });
      for (let i = 0; i < f; i++) ledger.append('dream_episode', { generator: 'mutation', op: opId, killed: true, fixed: false });
    };
    seedEvents('boundary', 12, 6);        // Beta(13,7) → 0.65 exactly
    seedEvents('negate-equality', 30, 0); // ~0.97 — mastered, only the easy floor picks it
    seedEvents('off-by-one', 0, 30);      // ~0.03 — far from the frontier

    const picks: Record<string, number> = {};
    for (let seed = 1; seed <= 25; seed++) {
      const engine = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-cur-')), { seed });
      const picked = engine.pickOperator().id;
      picks[picked] = (picks[picked] || 0) + 1;
    }
    // ~80% frontier (boundary), ~20% easiest (negate-equality), never the hopeless class.
    expect(picks['boundary']).toBeGreaterThanOrEqual(15);
    expect(picks['off-by-one'] || 0).toBe(0);
    expect((picks['boundary'] || 0) + (picks['negate-equality'] || 0)).toBe(25);
  });

  it('IRT: θ and per-class b separate with evidence; sampler switches to IRT at n≥100 and explores hard classes', () => {
    const ledger = getEventLedger();
    const seedEvents = (opId: string, s: number, f: number) => {
      for (let i = 0; i < s; i++) ledger.append('dream_episode', { generator: 'mutation', op: opId, killed: true, fixed: true });
      for (let i = 0; i < f; i++) ledger.append('dream_episode', { generator: 'mutation', op: opId, killed: true, fixed: false });
    };
    seedEvents('negate-equality', 60, 0); // consistently solved → its b must FALL below prior
    seedEvents('off-by-one', 0, 60);      // consistently failed → its b must RISE above prior

    const engine = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-irt-')), { seed: 1 });
    const irt = engine.irt();
    expect(irt.n).toBe(120);
    expect(irt.active).toBe(true);
    expect(irt.b['negate-equality']).toBeLessThan((1 - 2.5) * 0.8);
    expect(irt.b['off-by-one']).toBeGreaterThan((3 - 2.5) * 0.8);
    const p = (id: string) => 1 / (1 + Math.exp(-(irt.theta - irt.b[id])));
    expect(p('negate-equality')).toBeGreaterThan(p('off-by-one'));

    // Sampler now runs on IRT predictions: easy floor picks the mastered class, the 10%
    // exploration slice picks the hardest, the rest sits at the frontier.
    const picks: Record<string, number> = {};
    for (let seed = 1; seed <= 60; seed++) {
      const e = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-irt-')), { seed });
      const id = e.pickOperator().id;
      picks[id] = (picks[id] || 0) + 1;
    }
    expect(picks['negate-equality'] || 0).toBeGreaterThanOrEqual(5);  // ~20% easy floor
    expect(picks['off-by-one'] || 0).toBeGreaterThanOrEqual(1);       // hard exploration exists ONLY in IRT mode
    const total = Object.values(picks).reduce((a, b) => a + b, 0);
    expect(total).toBe(60);
  });

  it('IRT folds deterministically — two folds over the same ledger agree exactly', () => {
    const ledger = getEventLedger();
    for (let i = 0; i < 30; i++) ledger.append('dream_episode', { generator: 'mutation', op: 'boundary', killed: true, fixed: i % 2 === 0 });
    const a = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-irt2-'))).irt();
    const b = new MutationEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-irt2-'))).irt();
    expect(a.theta).toBe(b.theta);
    expect(a.b).toEqual(b.b);
  });
});
