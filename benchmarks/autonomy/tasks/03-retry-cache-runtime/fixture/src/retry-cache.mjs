export function createRetryCache({ loader, ttlMs, now }) {
  const entries = new Map();

  return {
    get(key, options = {}) {
      const existing = entries.get(key);
      if (existing && now() < existing.expiresAt) return existing.promise;

      const promise = Promise.resolve().then(() => loader(key, options));
      const entry = { promise, expiresAt: now() + ttlMs };

      // Defer the write so cache maintenance stays outside the caller's stack.
      queueMicrotask(() => entries.set(key, entry));
      return promise;
    },
  };
}
