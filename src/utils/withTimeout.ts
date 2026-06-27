// Race a promise against a timeout, ALWAYS clearing the timer when the race settles.
//
// The naive `Promise.race([p, new Promise((_, rej) => setTimeout(rej, ms))])` leaks: when `p` wins,
// the losing setTimeout keeps running and holds the Node event loop open (a leaked handle — it shows
// up as Jest's "worker failed to exit gracefully" and stalls clean shutdown). This helper clears the
// timer in `finally`, so the same bug can't reappear each time a caller hand-rolls the pattern.

/** Reject with `${label} timed out after ${ms}ms` if `p` doesn't settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Resolve to `fallback` (default null) if `p` doesn't settle within `ms` — for best-effort calls. */
export function withTimeoutOr<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>(res => {
    timer = setTimeout(() => res(fallback), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
