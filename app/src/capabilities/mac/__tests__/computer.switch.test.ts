/**
 * Target-switch transaction tests.
 *
 * The property that matters is ORDERING: input must be frozen from the moment the switch begins
 * until a frame carrying the new target's identity exists. Everything else here exists to make that
 * one guarantee un-bypassable — a mis-sequenced switch throws in a test instead of delivering a
 * click to the app we just switched away from.
 */

import { TargetSwitch, SwitchLatencyLog, TargetIdentity } from '../switch';

const notes: TargetIdentity = { app: 'Notes', pid: 100, windowId: 1, bundleId: 'com.apple.Notes' };
const finder: TargetIdentity = { app: 'Finder', pid: 200, windowId: 2, bundleId: 'com.apple.finder' };

function walk(t: TargetSwitch): TargetSwitch {
  return t.resolve().freezeInput().activate().confirmFrontmost().confirmWindow(2).switchCapture().acquireFrame('f1-200-2');
}

describe('TargetSwitch — ordering and input freeze', () => {
  it('freezes input for the entire dangerous middle of the transaction', () => {
    const t = new TargetSwitch(notes, finder);
    expect(t.inputAllowed).toBe(true); // nothing has begun yet

    t.resolve();
    expect(t.inputAllowed).toBe(true);

    t.freezeInput();
    // Every phase from here until commit must refuse input — this is the whole point.
    expect(t.inputAllowed).toBe(false);
    t.activate();
    expect(t.inputAllowed).toBe(false);
    t.confirmFrontmost();
    expect(t.inputAllowed).toBe(false);
    t.confirmWindow(2);
    expect(t.inputAllowed).toBe(false);
    t.switchCapture();
    expect(t.inputAllowed).toBe(false);
    t.acquireFrame('f1-200-2');
    expect(t.inputAllowed).toBe(false);

    t.commit();
    expect(t.inputAllowed).toBe(true);
    expect(t.ok).toBe(true);
  });

  it('refuses to commit before a frame of the new target exists', () => {
    const t = new TargetSwitch(notes, finder);
    t.resolve().freezeInput().activate().confirmFrontmost().confirmWindow(2);
    // Committing here would release input while the newest frame still describes Notes.
    expect(() => t.commit()).toThrow(/illegal target-switch transition/);
    expect(t.inputAllowed).toBe(false);
  });

  it('refuses to activate before input is frozen', () => {
    const t = new TargetSwitch(notes, finder);
    t.resolve();
    expect(() => t.activate()).toThrow(/illegal target-switch transition/);
  });

  it('releases input on abort so a failed switch cannot wedge the session', () => {
    const t = new TargetSwitch(notes, finder);
    t.resolve().freezeInput().activate();
    t.abort('target application has no capturable window yet');
    expect(t.inputAllowed).toBe(true);
    expect(t.ok).toBe(false);
    expect(t.done).toBe(true);
    expect(t.trace.at(-1)?.note).toMatch(/no capturable window/);
  });

  it('records an activation warning without failing the transaction', () => {
    // An app can accept activation and still leave another app in front. That is a warning the
    // caller must report, not a reason to abandon a switch that can still capture a frame.
    const t = new TargetSwitch(notes, finder);
    t.resolve().freezeInput().activate();
    t.confirmFrontmost('Terminal is still frontmost');
    t.confirmWindow(2).switchCapture().acquireFrame('f1').commit();
    expect(t.ok).toBe(true);
    expect(t.frontmostWarning).toBe('Terminal is still frontmost');
  });

  it('distinguishes a real switch from a re-focus of the same window', () => {
    expect(new TargetSwitch(notes, finder).isRealSwitch).toBe(true);
    expect(new TargetSwitch(notes, { ...notes }).isRealSwitch).toBe(false);
    // Same app, different window IS a real switch — the coordinate context changes with it.
    expect(new TargetSwitch(notes, { ...notes, windowId: 9 }).isRealSwitch).toBe(true);
    // Nothing was active before: the first target acquisition counts as a switch.
    expect(new TargetSwitch(null, notes).isRealSwitch).toBe(true);
  });

  it('attributes elapsed time to the phase that spent it', () => {
    let now = 0;
    const clock = () => now;
    const t = new TargetSwitch(notes, finder, clock);
    t.resolve();
    now += 10; t.freezeInput();
    now += 200; t.activate();       // the expensive step
    now += 5; t.confirmFrontmost();
    now += 5; t.confirmWindow(2);
    now += 5; t.switchCapture();
    now += 30; t.acquireFrame('f1');
    now += 5; t.commit();

    expect(t.elapsedMs).toBe(260);
    const byPhase = Object.fromEntries(t.phaseDurations().map(p => [p.phase, p.ms]));
    expect(byPhase.activating).toBe(200);
    expect(byPhase['frame-acquired']).toBe(30);
  });

  it('walks every phase in order without throwing', () => {
    const t = walk(new TargetSwitch(notes, finder));
    t.commit();
    expect(t.trace.map(e => e.phase)).toEqual([
      'idle', 'resolved', 'input-frozen', 'activating',
      'frontmost-confirmed', 'window-confirmed', 'capture-switched', 'frame-acquired', 'committed',
    ]);
  });
});

describe('SwitchLatencyLog', () => {
  it('reports unknown rather than zero before anything is measured', () => {
    const log = new SwitchLatencyLog();
    expect(log.summary()).toEqual({ count: 0, p50: null, p95: null, worst: null });
  });

  it('computes nearest-rank percentiles', () => {
    const log = new SwitchLatencyLog();
    for (let i = 1; i <= 100; i++) log.record(i);
    expect(log.count).toBe(100);
    expect(log.percentile(0.5)).toBe(50);
    expect(log.percentile(0.95)).toBe(95);
    expect(log.summary().worst).toBe(100);
  });

  it('stays bounded so a long session cannot grow it without limit', () => {
    const log = new SwitchLatencyLog(10);
    for (let i = 1; i <= 100; i++) log.record(i);
    expect(log.count).toBe(10);
    // The window slid: only the most recent samples remain.
    expect(log.summary().worst).toBe(100);
    expect(log.percentile(0)).toBe(91);
  });
});
