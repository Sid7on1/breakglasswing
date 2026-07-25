# BiMax Engine — Static Bug Audit

**Date:** 2026-07-13
**Scope:** Backend `src/` engine (core, task, terminal, sandbox, storage, genome, graph, plugins).
**Method:** Static read-through. The full dynamic pass (tsc, ESLint, Jest x454 test files)
is pending — it needs the Linux sandbox, which is blocked until disk space is freed
(see `cleanup-storage.sh`). This document covers what a careful read found; it is not a
substitute for the compiled+tested pass.

---

## Fixed in this pass (high confidence, self-contained)

### 1. CommandQueue — timed-out items never removed  `src/terminal/queue.ts`
**Severity:** High (correctness / silent data loss)
On timeout the code ran `this.queue.filter(q => q.resolve !== resolve)`, but the item was
stored with `resolve: wrappedResolve`, not the raw `resolve`. The predicate therefore never
matched, so a timed-out entry stayed in the queue. It could later be dequeued and executed,
and its `wrappedResolve` would resolve a promise that had already rejected — the command ran
but its result was silently dropped, and a queue slot leaked.
**Fix:** compare against `wrappedResolve`; reorder declarations so the closure is valid.

### 2. Task fingerprint non-deterministic  `src/utils/hash.ts`
**Severity:** Medium (dedup/cache correctness)
`generateTaskFingerprint` hashed `JSON.stringify(payload)`. `JSON.stringify` preserves key
**insertion order**, so two structurally-identical tasks with different key order produced
different fingerprints — breaking any dedup or cache keyed on the fingerprint.
**Fix:** `stableStringify` emits object keys sorted at every level before hashing.
*Note:* fingerprint values change once; any persisted fingerprints reset (harmless).

### 3. Validator shell injection + staging collision  `src/sandbox/validator.ts` — FILE SINCE DELETED
**Severity:** High (security) / Medium (concurrency)
*Superseded:* `src/sandbox/validator.ts` had no live importers and was removed in the dead-code
sweep, so this hardening no longer ships anywhere. Kept for the record.
The validator interpolated a file path into a shell string
(`npx tsc ... "${stagingFile}"` via `exec`). A path containing shell metacharacters
(`"`, `$(...)`, backticks) could execute arbitrary commands — serious for an autonomous
agent that may act on model/attacker-influenced paths. It also named the temp file with
`Date.now()`, so two validations in the same millisecond clobbered each other.
**Fix:** switched to `execFile` (no shell, array args) and a `randomUUID` staging filename.

---

## Observations for the verified pass (not yet changed)

- ~~**`validator.ts` — single-file `tsc` yields false negatives.**~~ **Moot** — file deleted
  (no live importers). Recorded so a future audit does not re-find it.
- **`classifier.ts` — error detail lost.** The final `throw` omits `lastError`; on a non-200
  path `lastError` isn't updated, so the retry warning to the model is empty. Include the
  last failure reason in the fatal message.
- ~~**`db.connection.ts` — one corrupt WAL line drops all events.**~~ **Moot** — the whole
  `src/storage/` module was dead code and is deleted. The real event store is
  `src/mind/event.ledger.ts` (SQLite), which does not share this bug.
- ~~**`rollback.ts` — edge case.**~~ **Moot** — file deleted (no live importers). `/undo` and
  `/backups` are served by `cli/fileEditor.ts`, which was never this code path.
- **`plugin.evaluator.ts` — uses `console.log` instead of `Logger`** (inconsistent logging).

## Ruled out (checked, NOT bugs)
- **`guardian.ts` missing `await` on `analyzeSingleFile`** — `StaticAnalyzer.analyzeSingleFile`
  is synchronous (`: void`), so no await is needed. (The tree-sitter analyzer's async variant
  is a different class and isn't used here.)
- **`multiplexer.ts` check-then-act race** — `BaseAdapter.execute` sets `isBusy = true`
  synchronously before its first `await`, so a concurrent `routeCommand` sees the session as
  busy. Dispatch is race-safe.

## Coverage note
~15 of ~40 backend source modules were read closely; ~454 `.ts` files (incl. tests) exist.
A complete "zero bugs" guarantee requires the dynamic pass: `tsc --noEmit`, `eslint`, and the
full Jest suite. That is queued and blocked only on free disk space.
