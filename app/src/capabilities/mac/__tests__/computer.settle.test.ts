/**
 * Adaptive wait tests.
 *
 * The point of these is that a wait costs what the app actually costs, and that a timeout is
 * REPORTED rather than swallowed. A wait that silently gives up looks exactly like a wait that
 * succeeded, and that is how a race becomes a fixed sleep that grows every time it is hit.
 *
 * Clock and sleeper are injected so the assertions are exact rather than timing-flaky in CI.
 */

import { waitFor, waitUntil, waitForStableFrame } from '../settle';

/** Virtual clock: sleeping advances time instantly, so a 2s budget costs no real time. */
function virtualClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => { now += ms; },
    advance: (ms: number) => { now += ms; },
    get time() { return now; },
  };
}

describe('waitFor', () => {
  it('returns as soon as the condition holds, not after the budget', async () => {
    const clock = virtualClock();
    let calls = 0;
    const result = await waitFor(
      async () => (++calls >= 3 ? 'ready' : null),
      { timeoutMs: 5000, intervalMs: 40, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(true);
    expect(result.value).toBe('ready');
    expect(result.polls).toBe(3);
    // Two sleeps of 40ms between three polls — it cost what the condition cost, not the budget.
    expect(result.elapsedMs).toBe(80);
  });

  it('reports a timeout honestly instead of pretending it settled', async () => {
    const clock = virtualClock();
    const result = await waitFor(
      async () => null,
      { timeoutMs: 200, intervalMs: 50, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.value).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(200);
  });

  it('honours an initial delay before the first poll', async () => {
    const clock = virtualClock();
    let firstPollAt = -1;
    await waitFor(
      async () => { if (firstPollAt < 0) firstPollAt = clock.time; return 'ok'; },
      { initialDelayMs: 300, sleep: clock.sleep, now: clock.now },
    );
    expect(firstPollAt).toBe(300);
  });

  it('tolerates a few probe errors — a window being replaced legitimately fails a read', async () => {
    const clock = virtualClock();
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls++;
        if (calls <= 2) throw new Error('no accessible window');
        return 'window';
      },
      { timeoutMs: 5000, intervalMs: 10, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(true);
    expect(result.value).toBe('window');
  });

  it('gives up when the probe keeps throwing — the target is gone, not slow', async () => {
    const clock = virtualClock();
    const result = await waitFor(
      async () => { throw new Error('process exited'); },
      { timeoutMs: 60_000, intervalMs: 10, maxConsecutiveErrors: 3, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(false);
    // Not a timeout — a different, more specific failure, and the cause is preserved.
    expect(result.timedOut).toBe(false);
    expect(result.lastError).toMatch(/process exited/);
    expect(result.polls).toBe(3);
  });

  it('treats a recovered error as not-consecutive', async () => {
    const clock = virtualClock();
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls++;
        // Fails, recovers, fails, recovers… never 3 in a row, so it must not give up.
        if (calls % 2 === 1 && calls < 8) throw new Error('transient');
        return calls >= 8 ? 'ok' : null;
      },
      { timeoutMs: 5000, intervalMs: 10, maxConsecutiveErrors: 3, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(true);
  });
});

describe('waitUntil', () => {
  it('wraps a boolean condition, returning on the poll that first holds', async () => {
    const clock = virtualClock();
    let polls = 0;
    const result = await waitUntil(
      async () => ++polls >= 3,
      { timeoutMs: 1000, intervalMs: 10, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(true);
    expect(result.polls).toBe(3);
    expect(result.elapsedMs).toBe(20); // two 10ms gaps between three polls
  });

  it('times out on a condition that never holds', async () => {
    const clock = virtualClock();
    const result = await waitUntil(async () => false, { timeoutMs: 100, intervalMs: 25, sleep: clock.sleep, now: clock.now });
    expect(result.timedOut).toBe(true);
  });
});

describe('waitForStableFrame', () => {
  it('settles once the screen stops changing', async () => {
    const clock = virtualClock();
    // An animation that resolves: three different frames, then the same one repeatedly.
    const digests = ['a', 'b', 'c', 'final', 'final', 'final'];
    let i = 0;
    const result = await waitForStableFrame(
      async () => digests[Math.min(i++, digests.length - 1)],
      { timeoutMs: 5000, intervalMs: 20, stableRounds: 2, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(true);
    expect(result.value).toBe('final');
  });

  it('times out on a screen that never settles, rather than blocking forever', async () => {
    const clock = virtualClock();
    let n = 0;
    // A blinking cursor or a spinner: every frame differs, forever.
    const result = await waitForStableFrame(
      async () => `frame-${n++}`,
      { timeoutMs: 300, intervalMs: 50, stableRounds: 2, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('does not count a failed capture as stability', async () => {
    const clock = virtualClock();
    // null means "could not read the screen" — treating that as two stable rounds would declare a
    // broken capture to be a settled UI.
    const result = await waitForStableFrame(
      async () => null,
      { timeoutMs: 200, intervalMs: 50, stableRounds: 2, sleep: clock.sleep, now: clock.now },
    );
    expect(result.settled).toBe(false);
    expect(result.timedOut).toBe(true);
  });
});
