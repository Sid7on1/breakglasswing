import { RecoveryController } from '../computer/recovery';

describe('RecoveryController — bounded, explicit terminal states', () => {
  it('a confirmed outcome stops with success and latches', () => {
    const r = new RecoveryController();
    expect(r.record('confirmed')).toBe('stop-success');
    expect(r.done).toBe(true);
    expect(r.succeeded).toBe(true);
    expect(r.record('failed')).toBe('stop-success'); // terminal latches — no further churn
  });

  it('a changed outcome continues and resets transient counters', () => {
    const r = new RecoveryController();
    expect(r.record('failed')).toBe('retry');
    expect(r.record('changed')).toBe('continue');
    expect(r.counters.retries).toBe(0);
  });

  it('retries are bounded, then it escalates, then it gives up', () => {
    const r = new RecoveryController({ maxRetries: 2, maxRecoveries: 3, maxNoProgress: 4 });
    expect(r.record('failed')).toBe('retry');      // 1
    expect(r.record('failed')).toBe('retry');      // 2
    expect(r.record('failed')).toBe('escalate');   // retries exhausted → escalate
    expect(r.record('failed')).toBe('escalate');
    expect(r.record('failed')).toBe('escalate');
    expect(r.record('failed')).toBe('stop-failure'); // recoveries exhausted
    expect(r.done).toBe(true);
    expect(r.succeeded).toBe(false);
  });

  it('no-change triggers corrective recovery, then stops on no-progress', () => {
    const r = new RecoveryController({ maxRetries: 2, maxRecoveries: 9, maxNoProgress: 4 });
    expect(r.record('no-change')).toBe('recover');
    expect(r.record('no-change')).toBe('recover');
    expect(r.record('no-change')).toBe('recover');
    expect(r.record('no-change')).toBe('stop-failure'); // 4th consecutive no-change → no progress
  });

  it('wrong-window is a recoverable (re-focus) condition', () => {
    const r = new RecoveryController();
    expect(r.record('wrong-window')).toBe('recover');
  });

  it('unverified proceeds cautiously without consuming budget', () => {
    const r = new RecoveryController();
    expect(r.record('unverified')).toBe('continue');
    expect(r.counters).toEqual({ retries: 0, recoveries: 0, noProgress: 0 });
  });
});
