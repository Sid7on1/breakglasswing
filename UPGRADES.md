# BiMax Upgrade Ledger

One line per upgrade, newest first. ✅ = implemented, tested, and in the
installed binary. ⏳ = open, deliberately deferred and marked. Every ✅ names
its commit; claims without a commit don't belong here.

## 2026-07-18 — overnight rebuild pass (commits 77a89465 → 9b35658d)

### Latency & truth-telling
- ✅ **First-token latency 4.7s → 1.85s** (mock-measured, 3× reproducible): a
  malformed-but-200 classifier response crashed at `choices[0]`, was re-billed
  to the API key as a 500, and the sole key's 5s cooldown was slept out by the
  main call every turn. Fixed as a class (`keySettled` flag + defensive
  `choices?.[0]` everywhere); anti-oscillation tests in
  `src/__tests__/keybilling.test.ts`. — `9b35658d`
- ✅ **Latency attribution engine** (`src/telemetry/netprobe.ts`): every slow
  (>8s) or timed-out first token fires a background DNS→TCP→TLS probe of the
  provider origin; `/perf` renders the evidence with a measured verdict
  (provider-side / local-dns / network-path / network-slow / unknown).
  — `77a89465`
- ✅ **"Provider cold/slow" removed from the stream watchdog** — stall copy is
  now neutral and points at `/perf`; the key-bench matcher covers both stall
  messages. — `77a89465`
- ✅ PTY regression rig fully green again (was failing `first token frame <
  2500ms`, a pre-existing defect reproduced on the prior commit). — `9b35658d`

### Browser / computer use (long-run reliability)
- ✅ **Browser crash recovery**: `ensure()` health-checks `browser.connected`;
  mid-action CDP disconnects reset the runtime honestly and relaunch next
  action with the same profile (logins survive). — `77a89465`
- ✅ **No zombie Chromes**: `close()` is bounded (3s) then hard-kills the
  child. — `77a89465`
- ✅ **Tab-explosion cap** (MAX_PAGES=4): stray popups/`target=_blank` pages
  pruned newest-survive on navigate/snapshot. — `77a89465`
- ✅ **Failure-loop memory**: the third identical failing action tells the
  model to change approach instead of looping. — `77a89465`

### Model system & vocabulary
- ✅ **One vocabulary everywhere** — `/model` description, vision-picker copy,
  `/tier` labels, and the live routing chip (was `fast/deep`) all speak
  Work · Quick · Vision; internal keys survive only on the wire. — `f9bbbcd5`
- ✅ **`/model work` / `/model quick` accepted as input** — previously
  `/model work` set the literal model id "work". Regression-tested.
  — `f9bbbcd5`

### Design language
- ✅ **docs/DESIGN_LANGUAGE.md** — Graphite & Ember codified as a contract:
  colour tokens + rules, symbol table, layout/density, voice guide grounded in
  real product copy, motion rules, rejected patterns. — `9eefbda5`
- ✅ Shimmer stall tint mirrored the wrong hex for `colErr`; now matches the
  token it names. — `9eefbda5`

### Tasks / workspaces
- ✅ **docs/TASK_WORKSPACES.md** — researched decision: one-tab-per-command
  REJECTED with rationale; adopted model = one conversation workspace +
  focusable live panels + state chips. — `36eff113`
- ✅ **Live browser-session chip (◍)** in the TUI footer from
  `ui_snapshot.computer` (host only, taint-aware) — a running automated
  browser is never invisible. — `36eff113`

### Hygiene
- ✅ `.bimax/browser/` + `.bimax/computer/` runtime state gitignored.
- ✅ Removed test residue `{"model":"mock"}` that `healModel` persisted into
  `~/.breakglass/config.json` during benchmarking.

## Open / deferred (marked, not hidden)
- ⏳ `healModel` persists a healed model id into the user's global config —
  correct for real drift, but a benchmark against a mock can pollute it
  (observed live). Needs a "don't persist when the model came from env" guard.
- ⏳ Remaining ~1.85s mock first-token = pre-flight classifier round-trip when
  Work≠Quick models; the unified single-model path already skips it. A
  parallel classifier+main-dispatch would cut it further.
- ⏳ Classifier response parsing still falls back silently on empty content;
  the mock's non-stream endpoint shape should be verified against real NIM
  aux-call shapes.
- ⏳ Long-running *shell* processes still stream inline (no dedicated panel);
  see docs/TASK_WORKSPACES.md "deliberately deferred".
- ⏳ Desktop runtime: no screenshot deduplication yet; failure-loop memory
  exists only in the browser runtime.
- ⏳ macOS notarization + minisign release key (external, unchanged).
