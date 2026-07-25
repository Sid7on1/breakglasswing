/**
 * Adaptive waiting for computer use.
 *
 * A fixed sleep is wrong in both directions at once: too long for the app that was ready in 30 ms,
 * too short for the one that needed 600 ms. The first costs latency on every single action, and the
 * second is a race that shows up as "the click landed before the window existed" — which then gets
 * papered over by making the sleep longer, taxing everyone.
 *
 * So waits are expressed as a CONDITION plus a budget: poll until the thing we are actually waiting
 * for is true, and give up honestly at the deadline instead of pretending it happened. The result
 * reports how long it really took and whether it timed out, so a slow app is measurable rather than
 * hidden inside a constant.
 *
 * Pure timing logic with an injectable clock and sleeper, so the behaviour is testable without
 * real-time flakiness in CI.
 */

export interface SettleOptions {
  /** Hard budget. On expiry the wait returns `timedOut`, it never throws — the caller decides. */
  timeoutMs?: number;
  /** Gap between polls. Kept small: a poll is cheap next to the latency it saves. */
  intervalMs?: number;
  /** Wait this long before the FIRST poll, for changes that cannot possibly be instant. */
  initialDelayMs?: number;
  /** Give up early when the probe throws this many times in a row (the target is gone). */
  maxConsecutiveErrors?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface SettleResult<T> {
  /** The satisfying value, or null when the wait timed out. */
  value: T | null;
  settled: boolean;
  timedOut: boolean;
  elapsedMs: number;
  polls: number;
  /** Last error the probe threw, when it never succeeded. */
  lastError?: string;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Poll `probe` until it returns a non-null value, or the budget expires.
 *
 * A probe returning null means "not yet". A probe THROWING means the check itself failed — which is
 * different, and is tolerated for a few rounds because a window being replaced mid-activation
 * legitimately makes a geometry read fail before it succeeds.
 */
export async function waitFor<T>(probe: () => Promise<T | null>, opts: SettleOptions = {}): Promise<SettleResult<T>> {
  const {
    timeoutMs = 2000,
    intervalMs = 40,
    initialDelayMs = 0,
    maxConsecutiveErrors = 3,
    sleep = defaultSleep,
    now = Date.now,
  } = opts;

  const startedAt = now();
  let polls = 0;
  let consecutiveErrors = 0;
  let lastError: string | undefined;

  if (initialDelayMs > 0) await sleep(initialDelayMs);

  for (;;) {
    polls++;
    try {
      const value = await probe();
      consecutiveErrors = 0;
      if (value !== null && value !== undefined) {
        return { value, settled: true, timedOut: false, elapsedMs: now() - startedAt, polls };
      }
    } catch (err: any) {
      lastError = String(err?.message || err);
      if (++consecutiveErrors >= maxConsecutiveErrors) {
        return { value: null, settled: false, timedOut: false, elapsedMs: now() - startedAt, polls, lastError };
      }
    }
    if (now() - startedAt >= timeoutMs) {
      return { value: null, settled: false, timedOut: true, elapsedMs: now() - startedAt, polls, lastError };
    }
    await sleep(intervalMs);
  }
}

/** Convenience wrapper for a boolean condition. */
export async function waitUntil(condition: () => Promise<boolean>, opts: SettleOptions = {}): Promise<SettleResult<true>> {
  return waitFor<true>(async () => (await condition()) ? true : null, opts);
}

/**
 * Wait for the screen to stop changing — the honest way to know an animation, a sheet, or a page
 * load has finished, rather than guessing a duration.
 *
 * "Settled" means `stableRounds` consecutive identical digests. A UI with a blinking cursor or a
 * spinner never fully settles, so the budget is a real outcome and the caller must handle it: this
 * returns `timedOut` with the last digest instead of blocking forever.
 */
export async function waitForStableFrame(
  digest: () => Promise<string | null>,
  opts: SettleOptions & { stableRounds?: number } = {},
): Promise<SettleResult<string> & { stableRounds: number }> {
  const { stableRounds = 2, ...rest } = opts;
  let previous: string | null = null;
  let stable = 0;
  let achieved = 0;

  const result = await waitFor<string>(async () => {
    const current = await digest();
    if (current == null) { stable = 0; return null; }
    if (previous !== null && current === previous) stable++;
    else stable = 0;
    previous = current;
    achieved = stable;
    return stable >= stableRounds ? current : null;
  }, rest);

  return { ...result, stableRounds: achieved };
}
