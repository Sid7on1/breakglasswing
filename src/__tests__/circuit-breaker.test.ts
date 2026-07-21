import {
  CircuitBreaker,
  BreakerState,
  BreakerOpen,
  Outcome,
  RetryPolicy,
  Disposition,
  serverConfig,
  clientConfig,
  configFromEnv,
  parseFailureCodes,
  withBreaker,
  type Clock,
} from '../core/circuit-breaker';

/** Deterministic clock so cool-down windows can be advanced by hand. */
function mockClock(): { clock: Clock; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { clock: () => t, advance: (ms) => { t += ms; } };
}

function failN(b: CircuitBreaker, n: number): void {
  for (let i = 0; i < n; i++) b.record(Outcome.Failure);
}

describe('CircuitBreaker state machine', () => {
  it('stays Closed below min_samples even at 100% failure', () => {
    const b = new CircuitBreaker(serverConfig()); // minSamples=10
    failN(b, 9);
    expect(b.state()).toBe(BreakerState.Closed);
    expect(b.isOpen()).toBe(false);
  });

  it('trips to Open once min_samples and error-rate threshold are both met', () => {
    const b = new CircuitBreaker(serverConfig()); // minSamples=10, threshold=0.5
    failN(b, 10);
    expect(b.state()).toBe(BreakerState.Open);
    expect(b.isOpen()).toBe(true);
    expect(() => b.check()).toThrow(BreakerOpen);
  });

  it('does not trip when error rate is below threshold', () => {
    const b = new CircuitBreaker({ ...serverConfig(), minSamples: 4, errorRateThreshold: 0.5 });
    b.record(Outcome.Failure);
    b.record(Outcome.Success);
    b.record(Outcome.Failure);
    b.record(Outcome.Success); // 2/4 = 0.5 → trips (>=)
    expect(b.state()).toBe(BreakerState.Open);
  });

  it('check() advertises a shrinking retry-after while Open', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker(serverConfig(), { clock }); // openDurationMs=10_000
    failN(b, 10);
    try { b.check(); throw new Error('expected BreakerOpen'); }
    catch (e) { expect((e as BreakerOpen).retryAfterMs).toBe(10_000); }
    advance(3_000);
    try { b.check(); throw new Error('expected BreakerOpen'); }
    catch (e) { expect((e as BreakerOpen).retryAfterMs).toBe(7_000); }
  });

  it('transitions Open → HalfOpen after the cool-down and admits one probe', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker(serverConfig(), { clock });
    failN(b, 10);
    expect(b.state()).toBe(BreakerState.Open);
    advance(10_000);
    expect(() => b.check()).not.toThrow(); // admitted → now HalfOpen
    expect(b.state()).toBe(BreakerState.HalfOpen);
  });

  it('HalfOpen closes on a successful probe and clears the window', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker(serverConfig(), { clock });
    failN(b, 10);
    advance(10_000);
    b.check();
    b.record(Outcome.Success);
    expect(b.state()).toBe(BreakerState.Closed);
    expect(b.errorRate()).toBe(0); // window cleared on close
  });

  it('HalfOpen re-opens on a failing probe', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker(serverConfig(), { clock });
    failN(b, 10);
    advance(10_000);
    b.check();
    b.record(Outcome.Failure);
    expect(b.state()).toBe(BreakerState.Open);
  });
});

describe('CircuitBreaker half-open probe accounting', () => {
  it('admits only halfOpenMaxProbes concurrent probes, rejecting extras with a short backoff', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker({ ...serverConfig(), halfOpenMaxProbes: 1 }, { clock });
    failN(b, 10);
    advance(10_000);
    b.check(); // claims the only slot → HalfOpen
    try { b.check(); throw new Error('expected BreakerOpen'); }
    catch (e) { expect((e as BreakerOpen).retryAfterMs).toBe(50); } // slot-exhausted backoff
  });

  it('reclaims an abandoned probe slot after the lease (open_duration) elapses', () => {
    const { clock, advance } = mockClock();
    const b = new CircuitBreaker(serverConfig(), { clock }); // openDurationMs=10_000
    failN(b, 10);
    advance(10_000);
    b.check(); // claims slot, never records (abandoned)
    advance(10_000); // lease elapses
    expect(() => b.check()).not.toThrow(); // reclaimed
  });
});

describe('withBreaker', () => {
  const noSleep = () => Promise.resolve();

  it('returns the value and records success', async () => {
    const b = new CircuitBreaker(serverConfig());
    const out = await withBreaker(b, async () => 42, { sleep: noSleep });
    expect(out).toBe(42);
    expect(b.errorRate()).toBe(0);
  });

  it('retries transient failures up to maxAttempts then throws the last error', async () => {
    const b = new CircuitBreaker(serverConfig());
    let calls = 0;
    await expect(
      withBreaker(b, async () => { calls++; throw new Error('boom'); }, { maxAttempts: 3, sleep: noSleep, random: () => 0 }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(3);
  });

  it('stops immediately when shouldRetry says the error is terminal', async () => {
    const b = new CircuitBreaker(serverConfig());
    let calls = 0;
    await expect(
      withBreaker(b, async () => { calls++; throw new Error('nope'); }, { maxAttempts: 5, shouldRetry: () => false, sleep: noSleep }),
    ).rejects.toThrow('nope');
    expect(calls).toBe(1);
  });

  it('sheds traffic (does not call fn) once the breaker is open', async () => {
    const b = new CircuitBreaker({ ...serverConfig(), minSamples: 2 });
    failN(b, 2); // open
    let calls = 0;
    await expect(withBreaker(b, async () => { calls++; return 1; }, { sleep: noSleep })).rejects.toThrow(BreakerOpen);
    expect(calls).toBe(0);
  });
});

describe('RetryPolicy', () => {
  it('server preset: 429 and all 5xx retry, others terminal, 2xx is null', () => {
    const p = RetryPolicy.server();
    for (const c of [429, 500, 502, 503, 504, 501, 520]) expect(p.shouldRetry(c)).toBe(true);
    for (const c of [400, 401, 403, 404]) expect(p.shouldRetry(c)).toBe(false);
    expect(p.classify(200)).toBeNull();
  });

  it('client-storage preset classifies auth/terminal/retryable correctly', () => {
    const p = RetryPolicy.clientStorage();
    for (const c of [400, 403, 404]) expect(p.classify(c)).toBe(Disposition.Terminal);
    expect(p.classify(401)).toBe(Disposition.AuthRefresh);
    for (const c of [429, 500, 503, 409, 422]) expect(p.classify(c)).toBe(Disposition.Retryable);
    expect(p.classify(200)).toBeNull();
  });
});

describe('config', () => {
  it('presets carry the documented thresholds', () => {
    expect(serverConfig()).toMatchObject({ minSamples: 10, openDurationMs: 10_000 });
    expect(clientConfig()).toMatchObject({ minSamples: 5, openDurationMs: 60_000 });
    expect(clientConfig().failureCodes.has(401)).toBe(true);
  });

  it('parseFailureCodes drops invalid entries', () => {
    const codes = parseFailureCodes('429, 500, x, 503');
    expect([...codes].sort((a, b) => a - b)).toEqual([429, 500, 503]);
  });

  it('configFromEnv reads CB_* overrides', () => {
    const cfg = configFromEnv('CB_', { CB_WINDOW_SECS: '30', CB_MIN_SAMPLES: '3', CB_ENABLED: 'false' });
    expect(cfg.windowDurationMs).toBe(30_000);
    expect(cfg.minSamples).toBe(3);
    expect(cfg.enabled).toBe(false);
  });

  it('disabled breaker never trips or sheds', () => {
    const b = new CircuitBreaker({ ...serverConfig(), enabled: false });
    failN(b, 50);
    expect(b.state()).toBe(BreakerState.Closed);
    expect(() => b.check()).not.toThrow();
  });
});
