# Backend Stabilization Report

Date: 2026-07-15
Scope: the three P0s and two P1s in `CLAUDE_BACKEND_HANDOFF.md`. Engine/provider/streaming/security/
installer only — no `tui/**`, no `site/src/**`, no desktop renderer design. The engine→TUI wire
protocol was **not** changed; a proposal for optional timing events is in
`docs/PROTOCOL_CHANGE_PROPOSAL.md`.

## Result summary

| Item | Status | Verified by |
|---|---|---|
| P0 — credential permissions too permissive | **Fixed** | `env.loader.perms.test.ts` (7) + live `stat` on the real install |
| P0 — short replies don't stream | **Fixed** | `stream.strategy.test.ts` (14) + `llm.filter.test.ts` (18) |
| P0 — trivial-turn latency + no fast lane | **Fixed** (in-process) | `perf.test.ts`, `performance.budget.test.ts`, `convo.lane.test.ts`, `model.router.test.ts` |
| P1 — heavyweight startup + duplicate sidecar | **Fixed** | `headroom.singleton.test.ts` (9) + lazy-boot code change |
| P1 — installer integrity | **Fixed**; macOS signing/notarization **wired, not executed** (needs Apple creds) | live install/rollback/uninstall run + `docs/SECURITY_INSTALL.md` |

All commands below were run on macOS (darwin-arm64), Node 22.

---

## P0-1 — Owner-only provider credentials

`~/.breakglass` → `0700`, `~/.breakglass/.env` → `0600`, migrated on **every** startup before the file
is read (`loadGlobalEnv` → `hardenBreakglassPermissions`). Added: symlink safety (a symlinked dir or
`.env` is never `chmod`'d or followed on read; writes through a symlink are refused), best-effort on
non-POSIX filesystems, and a `BIMAX_BREAKGLASS_DIR` seam for hermetic tests. Logging is path-only,
never the secret.

Files: `src/cli/env.loader.ts`, `src/__tests__/env.loader.perms.test.ts`.

```
$ npx jest env.loader.perms --coverage=false --maxWorkers=2
  Tests: 7 passed   (new-creation 0700/0600, 0755/0644→0700/0600 migration, symlink-not-followed,
                     symlink-write-refused, no-op when absent, path-only logging)

# Live check of the real install (perms only, no secret printed):
$ stat -f "%A %N" ~/.breakglass ~/.breakglass/.env
  700 /Users/.../.breakglass
  600 /Users/.../.breakglass/.env
```

## P0-2 — Short replies now stream

Root cause confirmed: the default `stepfun-ai/step-3.7-flash` is marked `inlineReasoning`, which lifted
the think-filter's preamble cap to infinity, so a short tag-free answer (`Hey! What are we building
today?`) was buffered and released in one burst by `flush()` at stream end.

Fix: distinguish **opener-based** reasoners (step-3.7, which always wraps reasoning in
`<thinking>…</thinking>`) from **opener-less** ones (step-3.5, bare `</think>`). New capability
`openerlessReasoning` + the pure `chooseThinkStrategy(caps, implicitThink, knownReasoner)`:

- opener-based / native / plain-content → **implicit=false**: a tag-free answer streams from the first
  token; a `<thinking>` block is still hidden by the explicit filter path (no CoT leak).
- opener-less / unknown → **implicit=true, bounded cap**: the ambiguous lead is buffered until a
  `</think>` closer, a tool call, or the cap — the bounded hybrid the handoff asked for, never "wait
  forever."

Also added engine timing marks for first-raw-provider-chunk and first-visible-token (see P0-3).

Files: `src/core/capabilities.ts`, `src/core/llm.stream.ts`, `src/core/llm.adapter.ts`,
`src/__tests__/stream.strategy.test.ts`.

The six required regressions (all green in `stream.strategy.test.ts`):

1. tag-free short answer split across chunks → visible deltas arrive **before** stream end.
2. explicit `<think>` / `<thinking>` blocks → reasoning stays hidden.
3. opener-less reasoning ending in `</think>` → reasoning stays hidden.
4. tool call while reasoning is buffered → buffered reasoning diverted, not displayed.
5. Step-family turn with **no** tags → streams live.
6. Step-family turn **with** tags → hidden.

```
$ npx jest stream.strategy llm.filter capabilities --coverage=false --maxWorkers=2
  Tests: 14 + 18 + (capabilities) passed
```

## P0-3 — Trivial-turn latency, instrumentation, and a real fast lane

**Instrumentation.** `src/telemetry/perf.ts` now records a per-turn monotonic phase timeline:
input-received → routing-complete → context-assembly-complete → provider-request-started →
first-raw-provider-chunk → first-visible-token → stream-complete. Marks are first-wins and no-op when
no turn is active (so classifier/critic/sub-agent calls don't pollute the main turn). It derives and
persists a **secret-free** record (`~/.bimax/perf.jsonl`, mode 0600, bounded to 200 rows, timings +
lane + model id only) that is reloaded on boot, so `/perf` still explains the previous turn after a
restart/crash. `/perf` now shows **Bimax overhead vs provider wait vs render** separately.

**Fast lane.** `AgentPersona.converse()` is a lightweight conversation lane: for messages a local,
LLM-free gate (`isConversational`) confirms are trivially conversational (greetings, acks, a small set
of identity/meta questions), it streams a single plain completion with a minimal system prompt and
**no tools** — deliberately skipping graph search, vector-memory recall, exemplar retrieval,
outcome/verification machinery, self-critic/adversarial passes, and compression startup. Reasoning
privacy is preserved (same `ThinkTagFilter`). The gate is conservative: any coding verb, code/stack
context, file path, `@mention`, URL, or non-trivial length falls through to the full harness, so coding
requests are never down-routed. A heavy tier pin or an engine wake also stays on the full harness.

`HeadlessSession.runTurn` picks the lane, marks the phase boundaries, and closes the timeline.

**Gates (fail, not just report).** `performance.budget.ts` adds `greeting_overhead_p95 ≤ 250ms` and
`render_p95 ≤ 100ms`, plus `assertPerformanceBudgets()` which **throws** on any measured regression.

Files: `src/telemetry/perf.ts`, `src/telemetry/performance.budget.ts`, `src/cli/commands/perf.ts`,
`src/cli/model.router.ts`, `src/cli/personas/base.persona.ts`, `src/protocol/headless.session.ts`,
`src/protocol/host.ts`, `scripts/measure-greeting.mjs`, and their tests.

```
$ npx jest perf performance.budget model.router convo.lane --coverage=false --maxWorkers=2
  Tests passed, including:
   - convo.lane: "ten measured trivial turns hold the greeting-overhead gate (p95 <= 250ms)"
     → 10/10 greetings routed to converse(), 0 to the full harness; liteOverheadP95 <= 250ms.
   - model.router: "no hidden classifier call for a locally obvious greeting"
     → isConversational('hi') && decideTier via 'heuristic', 0 chatCompletion calls.
   - perf: phase timeline split + secret-free persistence surviving a simulated restart.
```

On defaults (requirement 6): defaults were **not** changed. Step 3.7 stays the coding model; the fast
lane removes the harness overhead without swapping the model. Choosing a different LITE default is a
benchmarking decision that needs a live provider and is left as an explicit follow-up (below).

### Live measurement — blocked by an expired provider key

A live end-to-end greeting run against NIM (`scripts/measure-greeting.mjs`) could not complete: the
configured `NVIDIA_API_KEY` returns **HTTP 401 (unauthorized/expired)**. This is external to the code.
With a valid key:

```
$ node scripts/measure-greeting.mjs 10 hi
# prints per-run ttf-visible, provider wait, render, total, chunk count, hidden-CoT chars,
# p50/p95 aggregates, and "streamed incrementally (>1 visible delta): N/10 runs" as the P0-2 proof.
```

All non-network gates (Bimax overhead, render path, streaming contract, no-hidden-classifier) are
verified in-process and deterministic.

## P1-1 — Lazy compression + singleton sidecar + quiet non-repo

**Lazy.** The eager `ensureHeadroomProxy()` at engine boot (`container.ts`) is removed. The Kompress
proxy is now brought up **only** the first time a turn is actually under token pressure
(`context.manager.ts`), fire-and-forget and idempotent — a greeting never provisions a Python venv or
spawns a sidecar.

**Singleton (no `:8788` race).** `headroomProxy.ts` gains a cross-process lockfile
(`vendor/headroom/proxy.lock`, `{pid, port}`), health probing, stale-lock cleanup, atomic lock
acquisition, dynamic-port fallback when 8788 is taken, sibling reuse, and lock release on deterministic
shutdown. The decision is a pure `planProxyStartup(...)` so the race logic is unit-testable without a
real spawn.

**Quiet non-repo.** `getGitStatus` now short-circuits on `isGitRepo`, and it/`gitLog`/`gitDiff`
silence git stderr, so a non-repository launch no longer spills `fatal: not a git repository`.

Files: `src/memory/headroomProxy.ts`, `src/memory/context.manager.ts`, `src/core/container.ts`,
`src/cli/git.ts`, `src/__tests__/headroom.singleton.test.ts`, `src/__tests__/git.noise.test.ts`.

```
$ npx jest headroom.singleton git.noise context.manager headroom.compress --coverage=false --maxWorkers=2
  Tests passed:
   - singleton: reuse-healthy, spawn-on-default-when-free, spawn-on-DYNAMIC-when-8788-taken,
     external-proxy defer, atomic lock (2nd claimant loses), release-only-if-owned, free/busy port.
   - git.noise: non-repo returns null/false without throwing; a child process running the real
     helpers emits NO "fatal: not a git repository" on stderr.
   - context.manager / headroom.compress: 31 passed (compression path intact).
```

## P1-2 — Installer integrity + macOS trust

`install.sh` is now transactional and fail-closed:

- verifies the **signature** of `SHA256SUMS` against a public key pinned in the script itself (not the
  adjacent file) — when a `.minisig` is present it MUST verify; then verifies the tarball SHA-256;
- extracts into an isolated scratch dir and installs only the exact expected binary name;
- **atomically replaces** the binary, smoke-tests `--version`, and **rolls back** to the preserved
  previous binary on failure;
- tiered uninstall: `--uninstall` (executable), `--uninstall --purge` (also `~/.breakglass`); per-repo
  `.bimax/` project data is never touched.

`release.sh` signs darwin binaries (Developer ID + hardened runtime + `codesign --verify`) and signs
`SHA256SUMS` with minisign when the respective credentials are present, warning clearly otherwise.
`app/electron-builder.yml` + `app/buildResources/entitlements.mac.plist` make the desktop app
hardened-runtime + notarization ready. `docs/SECURITY_INSTALL.md` documents the trust-verification
commands and the notarization flow (with clean-Mac verification), and is the page for the site owner to
surface.

```
# Transactional install → broken-update rollback → tiered uninstall (local-artifact path):
$ bash install.sh --install       # ✓ installed, ✓ bimax 1.0.1-test
$ bash install.sh --update        # broken binary → "rolled back to the previous version" ; still 1.0.1-test
$ bash install.sh --uninstall     # removed executable ; kept ~/.breakglass ; kept project data
$ bash -n install.sh              # syntax OK
```

**Not done here (requires Apple/signing credentials, external to this environment):** actual Developer
ID signing, notarization, stapling, and clean-Mac Gatekeeper verification; publishing the pinned
minisign key; and cutting the public **v1.0.1** GitHub release + confirming the live `/install`
endpoint resolves to it. All are wired and documented; they need secrets and a release runner.

## Verification matrix status

| Matrix item | Status |
|---|---|
| TS build + focused stream/filter/config tests | ✅ `npm run build` clean; suites green |
| Full engine test suite | ⚠️ Not run in full (repo policy: coverage spawns 8 workers, overheats this Mac). 160 tests across all touched/adjacent suites pass. |
| Clean temp-HOME onboarding without printing secrets | ✅ `env.loader.perms` (BIMAX_BREAKGLASS_DIR temp dir; path-only log) |
| Permission migration 0755/0644 → 0700/0600 | ✅ test + live |
| ≥10 measured trivial turns on the fast lane | ✅ in-process (`convo.lane`); ⚠️ live provider run blocked by 401 |
| Inline-reasoning + tag-free streaming fixtures | ✅ `stream.strategy`, `llm.filter` |
| Two simultaneous starts, no sidecar collision | ✅ `headroom.singleton` (planner + lock primitives) |
| Non-git dir, no fatal git noise | ✅ `git.noise` (child-process stderr captured) |
| Release checksum + signature/attestation verification | ✅ checksum live; signature wired (needs key) |
| Clean macOS install: version, signing identity, notarization | ⚠️ needs Apple creds — documented, not executed |
| Live installer resolving to new release | ⚠️ needs the v1.0.1 publish step |

## Known limitations (do not mislabel)

1. **Provider queue time is not a Bimax fix.** The greeting-total variance in the handoff includes
   NIM cold-start/queue time. The instrumentation now *separates* it (`providerWaitMs`), but Bimax
   cannot make the provider faster.
2. **Live greeting numbers pending a valid key.** The configured NVIDIA key is 401; rerun
   `scripts/measure-greeting.mjs` with a working key to capture the end-to-end split.
3. **macOS signing/notarization is wired, not performed** — no Developer ID cert in this environment.
4. **v1.0.1 is not yet public**; the live `/install` still serves whatever GitHub `latest` points to
   until the signed release is cut.
5. **Opener-based classification is load-bearing.** If a future Step variant emits opener-less CoT,
   set `openerlessReasoning` (or `BGW_CAP_OPENERLESS_REASONING=true`) so it uses the bounded implicit
   lane instead of streaming.
