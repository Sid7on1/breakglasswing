import { recordGuard, guardTimings, resetGuardTimings } from '../tools/guard.timing';

// WS5 step 3 — the guard-timing accumulator. Pure, in-memory: fold timings, sort by cumulative
// cost, ignore garbage inputs. No governor, no tool, no I/O.
describe('guard timing accumulator', () => {
  beforeEach(() => resetGuardTimings());

  it('folds count / total / max / avg per phase', () => {
    recordGuard('governor:approve', 10);
    recordGuard('governor:approve', 30);
    recordGuard('hooks:pre', 5);

    const rows = guardTimings();
    const approve = rows.find(r => r.phase === 'governor:approve')!;
    expect(approve.count).toBe(2);
    expect(approve.totalMs).toBe(40);
    expect(approve.maxMs).toBe(30);
    expect(approve.avgMs).toBe(20);

    const pre = rows.find(r => r.phase === 'hooks:pre')!;
    expect(pre.count).toBe(1);
    expect(pre.avgMs).toBe(5);
  });

  it('sorts slowest cumulative phase first', () => {
    recordGuard('hooks:pre', 5);
    recordGuard('governor:approve', 100);
    recordGuard('hooks:post', 20);
    expect(guardTimings().map(r => r.phase)).toEqual(['governor:approve', 'hooks:post', 'hooks:pre']);
  });

  it('ignores NaN / negative timings rather than poisoning the average', () => {
    recordGuard('governor:approve', 10);
    recordGuard('governor:approve', NaN);
    recordGuard('governor:approve', -5);
    const approve = guardTimings().find(r => r.phase === 'governor:approve')!;
    expect(approve.count).toBe(1); // only the valid 10ms sample counted
    expect(approve.totalMs).toBe(10);
  });

  it('reset clears all phases', () => {
    recordGuard('hooks:pre', 5);
    resetGuardTimings();
    expect(guardTimings()).toEqual([]);
  });
});
