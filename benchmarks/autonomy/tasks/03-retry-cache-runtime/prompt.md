The asynchronous retry cache in this fixture passes simple sequential use but violates its contract
under specific promise timing. Diagnose it by running the focused test and repair
`createRetryCache` in `src/retry-cache.mjs` without changing its exported name or adding dependencies.

The complete required contract is:

- `createRetryCache({ loader, ttlMs, now })` returns an object with `get(key, options = {})`.
  `now` is an injected function returning the current time in milliseconds.
- `get` calls `loader(key, options)` and returns a promise for its result. It passes the exact key and
  exact options object to the loader and must not mutate either the options object or nested values.
- Calls for the same key while its load is still pending must share that in-flight work: the loader is
  invoked exactly once and every caller receives the same resolved value. The pending load remains
  shared even if the injected clock advances before it settles.
- Different keys are independent. Their loaders may be in flight at the same time; one key must not
  serialize or block another key.
- A rejected load must be evicted when it settles. The rejection is delivered to its callers, and the
  next `get` for that key must invoke the loader again and may succeed.
- A successful value remains cached until its TTL expires. The TTL begins at successful resolution,
  not when loading starts. A call strictly before `resolvedAt + ttlMs` reuses the cached value. A call
  exactly at or after that boundary invokes the loader again.

The timing sequence is the defect: do not weaken the asynchronous test or replace the injected clock
with real delays. Run `npm test` after the change.
