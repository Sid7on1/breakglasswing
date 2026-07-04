import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { wilsonInterval, isotonicFit, expectedCalibrationError } from '../mind/stats';
import { EpistemicLedger } from '../mind/epistemic.ledger';

describe('Calibration statistics (v2 Phase 3 finish — Wilson, PAV isotonic, ECE)', () => {
  it('wilsonInterval: wide at small n, tight at large n, degenerate cases sane', () => {
    const small = wilsonInterval(2, 4);       // 50% observed, n=4
    const large = wilsonInterval(200, 400);   // 50% observed, n=400
    expect(small.hi - small.lo).toBeGreaterThan(large.hi - large.lo);
    expect(large.lo).toBeGreaterThan(0.44);
    expect(large.hi).toBeLessThan(0.56);
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    // 0/6 successes: upper bound well below 0.9 — the escalation test's arithmetic.
    expect(wilsonInterval(0, 6).hi).toBeLessThan(0.5);
  });

  it('isotonicFit: pools adjacent violators into a monotone curve, preserving weights', () => {
    // A dip at x=0.5 (violator) must merge with its neighbor.
    const fit = isotonicFit([
      { x: 0.1, y: 0.2, w: 10 },
      { x: 0.3, y: 0.5, w: 10 },
      { x: 0.5, y: 0.3, w: 10 },  // violates monotonicity vs 0.5's neighbor
      { x: 0.9, y: 0.9, w: 10 },
    ]);
    expect(fit.map(f => f.x)).toEqual([0.1, 0.3, 0.5, 0.9]);
    for (let i = 1; i < fit.length; i++) expect(fit[i].yhat).toBeGreaterThanOrEqual(fit[i - 1].yhat - 1e-12);
    expect(fit[1].yhat).toBeCloseTo(0.4); // (0.5·10 + 0.3·10) / 20
    expect(fit[2].yhat).toBeCloseTo(0.4);
    expect(isotonicFit([])).toEqual([]);
  });

  it('expectedCalibrationError: 0 when perfectly calibrated, grows with the gap', () => {
    expect(expectedCalibrationError([{ conf: 0.7, acc: 0.7, w: 10 }])).toBeCloseTo(0);
    expect(expectedCalibrationError([
      { conf: 0.9, acc: 0.5, w: 30 },
      { conf: 0.5, acc: 0.5, w: 10 },
    ])).toBeCloseTo(0.3); // (30/40)·0.4 + (10/40)·0
    expect(expectedCalibrationError([])).toBe(0);
  });

  it('escalation is significance-based: 4 misses cannot escalate, 6 can (same rate)', () => {
    const mk = () => new EpistemicLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-cal-')));

    // n=4 at 0% observed vs 90% stated: wilson hi ≈ 0.49 < 0.9 → still escalates? n<5 gate blocks it.
    const few = mk();
    for (let i = 0; i < 4; i++) few.openClaim('ts', 0.9, `src/f${i}.ts`);
    few.resolve(false, { command: 'npm test', output: Array.from({ length: 4 }, (_, i) => `FAIL src/f${i}.ts`).join('\n') });
    expect(few.overconfidentDomains()).toHaveLength(0); // below the weighted sample floor

    const many = mk();
    for (let i = 0; i < 6; i++) many.openClaim('ts', 0.9, `src/f${i}.ts`);
    many.resolve(false, { command: 'npm test', output: Array.from({ length: 6 }, (_, i) => `FAIL src/f${i}.ts`).join('\n') });
    expect(many.overconfidentDomains()).toHaveLength(1);

    // Mild, statistically unremarkable overconfidence must NOT escalate: 5/6 correct at 90% stated.
    const mild = mk();
    for (let i = 0; i < 6; i++) mild.openClaim('go', 0.9, `pkg/g${i}.go`);
    mild.resolve(false, { command: 'go test ./...', output: 'FAIL pkg/g0.go' });
    mild.resolve(true, { command: 'go test ./...', output: 'ok' });
    expect(mild.overconfidentDomains()).toHaveLength(0); // wilson hi of 5/6 ≈ 0.97 > 0.9
  });

  it('weighted attribution: basename-only evidence moves the stats at 0.7, exact at 1.0', () => {
    const led = new EpistemicLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-cal-')));
    led.openClaim('ts', 0.9, 'src/deep/nested/util.ts');
    // Failure names a same-named file WITHOUT a matching path → basename tier (0.7).
    expect(led.resolve(false, { command: 'npm test', output: 'FAIL lib/other/util.ts' })).toBe(1);
    const bucket = led.calibration().find(r => r.range === '90–100%')!;
    expect(bucket.n).toBeCloseTo(0.7);

    led.openClaim('ts', 0.9, 'src/deep/nested/util.ts');
    expect(led.resolve(false, { command: 'npm test', output: 'FAIL src/deep/nested/util.ts' })).toBe(1);
    expect(led.calibration().find(r => r.range === '90–100%')!.n).toBeCloseTo(1.7);
  });

  it('isotonicCurve on the ledger is monotone even when raw deciles are not', () => {
    const led = new EpistemicLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-cal-')));
    // 50%-stated claims that all succeed; 90%-stated claims that all fail → raw curve dips.
    for (let i = 0; i < 3; i++) led.openClaim('ts', 0.55, `src/lo${i}.ts`);
    led.resolve(true, { command: 'npm run build', output: 'ok' });
    for (let i = 0; i < 3; i++) led.openClaim('ts', 0.95, `src/hi${i}.ts`);
    led.resolve(false, { command: 'npm test', output: 'FAIL src/hi0.ts\nFAIL src/hi1.ts\nFAIL src/hi2.ts' });

    const curve = led.isotonicCurve();
    expect(curve.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].corrected).toBeGreaterThanOrEqual(curve[i - 1].corrected - 1e-12);
    }
    expect(led.ece()).toBeGreaterThan(0.4); // stated 0.55→1.0 and 0.95→0.0 is badly calibrated
  });
});
