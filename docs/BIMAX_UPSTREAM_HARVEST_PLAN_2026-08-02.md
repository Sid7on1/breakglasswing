# Bimax upstream harvest plan — engine and computer use

Status: implementation plan, not yet started

Date: 2026-08-02

Baseline: `92888f30` (v1.1.0, Phase 9 complete)

Supersedes nothing. Continues the phase numbering in
[BIMAX_CU_MASTER_REFACTOR_PLAN_2026-07-31.md](BIMAX_CU_MASTER_REFACTOR_PLAN_2026-07-31.md),
which ends at Phase 9. This document is Phases 10–16.

## Scope

Three upstream repositories were read against Bimax at `92888f30`:

| Repo | Local path | What it is |
|---|---|---|
| Codex | `/Users/vishsiddharth/Desktop/codex` | OpenAI Codex, Rust, ~100 crates under `codex-rs/` |
| Hermes | `/Users/vishsiddharth/Desktop/hermes-agent` | Python agent, ~200 modules under `agent/` + `tools/` |
| MacOS-Use | `/Users/vishsiddharth/Desktop/MacOS-Use` | Python PyObjC macOS AX agent, 8.1k lines |

The [2026-07-31 architecture audit](COMPUTER_USE_ARCHITECTURE_AUDIT_2026-07-31.md) already mined
these three for **computer use**. This document deliberately does not repeat it. It covers:

1. the **engine** axis the earlier audit never looked at (agent loop, context, prompt assembly,
   policy, exec, verification, model economics), and
2. the **computer-use** items that survived a re-check against the now-merged
   `native/BimaxComputerUseKit`.

## Hard constraint: additive only

**Nothing in this document deletes a capability, and no phase may show a large net line loss.**

Bimax's engine is already the product of harvesting several upstream projects. Those accumulated
approaches are the asset. A "cleaner" rewrite that drops one of them is a regression even when the
diff looks tidier, and a hand-tuned path that took live debugging to get right is worth more than
its line count suggests.

Rules, binding on every work item below:

1. **Extend, never swap.** An upstream technique is added *alongside* the existing implementation,
   not in place of it. Where both can answer, the existing path stays reachable.
2. **Reuse the pattern Phase 9 already proved.** `src/computer/backend.ts` +
   `cua.compat.backend.ts` + `native.rollout.ts` is exactly this shape: a new implementation, the
   old one intact as a fallback, a gate deciding which runs, and automatic rollback on failure.
   Every phase here should reach for that pattern before it reaches for an edit that removes code.
3. **Deletion budget.** Any phase whose `git diff --stat` shows more than ~200 deleted lines outside
   of tests needs an explicit written reason. Moving a file counts as deletion — prove it moved.
4. **No capability may become unreachable**, including behind a flag that defaults off with no way
   to turn it on.
5. **Retirement is a separate, later decision** with its own evidence, exactly as the CUA
   compatibility path is being retired: two stable releases, not one merge.

Where a row below names an existing file as its target, read that as *add a code path in this file*,
not *rewrite this file*. Three rows originally read as replacements and have been corrected:
**12.2**, **13.1**, **16.9**.

## How to read the references

Every work item cites `path:line` in the upstream repo. Those are read-only references — copy the
idea, not the Rust or Python. Bimax target files are repo-relative.

Line numbers are pinned to the local checkouts as of 2026-08-02. If a repo is updated, re-grep the
symbol name rather than trusting the line.

---

## 0. Verified already-ported — do not redo

Checked directly against the merged native kit and `src/`. These were live findings during the
research pass; each one was a candidate until the counter-evidence below turned up.

| Upstream technique | Upstream ref | Already in Bimax at |
|---|---|---|
| Two-stage early/late AX attribute batching | `MacOS-Use/macos_use/ax/core.py:505`, `:527` | `native/BimaxComputerUseKit/Sources/BimaxComputerUseKit/AccessibilityEngine.swift:91`, `:95` |
| `AXUIElementCopyMultipleAttributeValues` batching | `MacOS-Use/macos_use/ax/core.py:616` | `AccessibilityEngine.swift:487` |
| Element bbox clipped to window bbox (IOU) | `MacOS-Use/macos_use/agent/tree/service.py:211` | `AccessibilityEngine.swift:186–192` |
| `AXLink` → `AXHeading` browser correction | `MacOS-Use/.../tree/service.py:230` | `AccessibilityEngine.swift:601` |
| Window-control subrole naming (Close/Minimize/Full Screen) | `MacOS-Use/.../tree/service.py:263` | `AccessibilityEngine.swift:592–597` |
| Nameless cell → first `AXStaticText` descendant label | `MacOS-Use/.../tree/service.py:263` | `AccessibilityEngine.swift:583`, `:611` |
| `AXTitleUIElement` sibling-label dereference | `MacOS-Use/.../tree/service.py:365`, `:384–390` | `AccessibilityEngine.swift` (Phase 12.4, live-proven) |
| Prunable / interactive / container role policy | `MacOS-Use/macos_use/agent/tree/config.py:1–115` | `AccessibilityEngine.swift:75`, `:84`, `:183` |
| AXObserver push notifications | `MacOS-Use/macos_use/ax/events.py:100–140` | `native/.../AXEventTracker.swift:111`, `:187` |
| Fuzzy edit matching | `codex-rs/apply-patch/src/seek_sequence.rs:12` (3 tiers) | `src/tools/implementations/edit.tool.ts:21` (**9 tiers — ours is better**) |
| OS sandbox for shell | `codex-rs/linux-sandbox`, `bwrap` | `src/tools/implementations/bash.tool.ts:70` (`sandbox-exec` + `bwrap`) |
| Session resume | `codex-rs/core/src/rollout.rs` | `/sessions`, `src/core/agent.checkpoint.ts` |
| Retry / breaker / key rotation | Hermes `agent/retry_utils.py` | `src/core/circuit-breaker.ts:361`, `src/core/llm.adapter.ts:26` |

**MacOS-Use is fully mined and the final selected technique is now ported.** Do not spend further
research budget on that repo.

---

## 1. Findings catalog

### 1A. Engine

| # | Finding | Upstream ref | Bimax today | Gap |
|---|---|---|---|---|
| E1 | Model writes JS that composes tool calls in a V8 isolate | `codex-rs/code-mode-protocol/src/description.rs:12`; runtime `code-mode-runtime/src/runtime/globals.rs:15` | nothing (`isolated-vm`/`vm`/`quickjs` absent) | **total** |
| E2 | Prompt is structured world state, per-fragment SHA1, previous-section diff | `codex-rs/core/src/context/world_state/mod.rs:243–254`, `:156–158` | string composition in `src/cli/personas/base.persona.ts` | **total** |
| E3 | Second model risk-scores each action against a prose policy | `codex-rs/core/src/guardian/policy.md`, `review.rs:161`, `mod.rs:96` | deterministic vetoes only (`src/governor/policy.engine.ts`) | large |
| E4 | Declarative exec policy whose rules unit-test themselves at load | `codex-rs/execpolicy/README.md`, `src/rule.rs:40`, `:46` | `.breakglass/policy.json` + `src/governor/bash.analyzer.ts` | medium |
| E5 | Network rules (host/protocol allow-deny) in the same policy engine | `codex-rs/execpolicy/src/rule.rs:118`, `:149`, `:156` | none | **total** |
| E6 | 9-event hook lifecycle with context injection and output spill | `codex-rs/core/src/hook_runtime.rs:103–465`, `codex-rs/hooks/src/output_spill.rs` | 2 events (Pre/PostToolUse) in `src/tools/hooks.ts:15`, `:20` | large |
| E7 | PTY sessions with sandbox-denial auto-retry, approval cached | `codex-rs/core/src/unified_exec/mod.rs:1–23`, `process_manager.rs` | `src/terminal/multiplexer.ts` (no escalation flow) | medium |
| E8 | Head+tail capped output buffer with omission marker | `codex-rs/core/src/unified_exec/head_tail_buffer.rs:5`, `:114` | ad-hoc truncation | small |
| E9 | Cumulative per-turn unified diff, no filesystem re-read | `codex-rs/core/src/turn_diff_tracker.rs:47`, `:92`, `:114` | per-edit receipts only | small |
| E10 | Streaming patch parser — validate while the model is still emitting | `codex-rs/apply-patch/src/streaming_parser.rs:22`, `:139` | post-hoc parse | small |
| E11 | Mixture-of-Agents: parallel reference models feeding an aggregator | Hermes `agent/moa_loop.py:426`, `:732`, `:1161` | none | **total** |
| E12 | Reference models get a trimmed history (cost control for MoA) | Hermes `agent/moa_loop.py:598` | n/a | with E11 |
| E13 | PII redaction on advisor output before UI, trace, and prompt | Hermes `agent/moa_loop.py:45–55` | central redactor exists; no advisor path | with E11 |
| E14 | Verify-on-stop nudge, suppressed for doc-only turns | Hermes `agent/verification_stop.py:16–45` | `src/sandbox/verify.loop.ts` (no stop gate) | medium |
| E15 | Concurrent background review thread with auto-deny of side effects | Hermes `agent/background_review.py:635`, `:655`, `:974` | serial `src/review/review.manager.ts` | medium |
| E16 | Tool-call signature dedup → synthetic result with recovery hint | Hermes `agent/tool_guardrails.py:177`, `:273`, `:510`, `:533` | `src/core/loop-detector.ts` detects but does not teach | small |
| E17 | Typed provider-failure taxonomy driving failover | Hermes `agent/error_classifier.py:24`, `:597`, `:1202`, `:1231` | HTTP-code buckets in `circuit-breaker.ts:46` | low |
| E18 | Compaction quality: filter-safe preamble, iterative summaries, historical headings, token-budget tail, cheap pre-pass | Hermes `agent/context_compressor.py:1–18`, `:1058`, `:1221` | `src/memory/context.manager.ts` mechanism only | medium |
| E19 | Compaction as a first-class task with token budget and remote variant | `codex-rs/core/src/compact.rs:57`, `:144`, `:622`; `compact_token_budget.rs:26` | inline reactive compaction | medium |

### 1B. Computer use

| # | Finding | Upstream ref | Bimax today | Gap |
|---|---|---|---|---|
| C1 | Screenshots routed to an auxiliary vision model when the main model is text-only | Hermes `tools/computer_use/vision_routing.py:1–47` | `src/core/multimodal.ts:82–86` drops images with a notice | **large** |
| C2 | Multi-step GUI work as one script instead of N turns | E1 applied to computer tools | `src/computer/native.transaction.compiler.ts` (bounded, `set_value`/`set_selected` only) | large |
| C3 | `AXTitleUIElement` dereference for labels living in a sibling element | `MacOS-Use/macos_use/agent/tree/service.py:365`, `:384–390` | completed in `AccessibilityEngine.swift`; live fixture proof | done |
| C4 | Debounced AX watchdog that forces fresh reads on focus/structure change | `MacOS-Use/macos_use/agent/watchdog/service.py:14–45` | `AXEventTracker.swift` observes; no debounce-driven invalidation loop | small |
| C5 | Dedicated permissions doctor with remediation | Hermes `tools/computer_use/doctor.py` (864 lines) | `src/cli/commands/diagnostics.ts` (generic) | small |
| C6 | Small/text-only-model prompt variant for GUI turns | `MacOS-Use/macos_use/agent/prompt/system_flash.md` (23 lines vs 134) | persona split exists; no flash GUI variant | small |

---

## 2. The phases

### Phase 10 — Measurement baseline

Duration: 3–5 days. **Blocking for every later phase.**

The master plan's headline success criterion — *"at least 50% fewer model/tool turns on forms and
menus"* ([master plan §24.2](BIMAX_CU_MASTER_REFACTOR_PLAN_2026-07-31.md), line 2261) — is still
unmeasured, and [BIMAX_CU_PORTING_LEDGER.md:451](BIMAX_CU_PORTING_LEDGER.md) says so explicitly.
Every phase below claims a turn-count or token improvement. Without a denominator they are all
unfalsifiable.

| # | Work | Target |
|---|---|---|
| 10.1 | Per-task turn/tool-call/token counters emitted from the loop, keyed by task class (form, menu, navigation, code edit) | `src/core/agent.loop.ts`, `src/telemetry/` |
| 10.2 | A fixture task set that runs live against `BimaxCuFixture.app` — not `offline-trajectory-smoke`, which measures the harness, not the model | `benchmarks/` + `scripts/conformance-bimax-cu-*.sh` |
| 10.3 | Record the v1.1.0 numbers as the frozen baseline, committed | `docs/` |
| 10.4 | Stage spans already specified in §24 wired to real emission | `src/computer/phase.trace.ts` |

**Exit gate:** a committed baseline table of turns/tokens/wall-clock per fixture task class,
reproducible by one command.

**Risk:** low. **Do this first regardless of what else you pick.**

**DONE (2026-08-08).** The baseline is `docs/BIMAX_CU_BASELINE_v1.1.0.md`, reproduced by
`npm run benchmark:cu-baseline -- --repeats 3` (`scripts/benchmark-cu-baseline.ts`). 10.1 and 10.4
were already in place and wired — `src/telemetry/task.metrics.ts` counts turns inside the loop and
`src/computer/phase.trace.ts` emits real spans from `desktop.runtime.ts`; what was missing was
something to drive a real model against the fixture and read them. Every phase below now has a
denominator, so its claim can be missed out loud rather than restated.

Two things measured on the way that change what later phases should expect: the compatibility
backend contributes **zero** elements from the fixture's 40-row table (why the spec's "select table
row" task is not in the suite — it has no readable end state), and the AX tree intermittently
returns empty with the runtime substituting OCR, whose recognised text is not gradeable at all.
Live native conformance later showed that the first finding is **not** an `AXTitleUIElement` defect:
the native engine sees 10 visible rows, 10 named cells, and their static text. The selectable rows
remain nameless, while the compatibility driver drops the table entirely. Treat those as separate
follow-up gaps.

---

### Phase 11 — Code mode core (engine)

Duration: 3–4 weeks. The single highest-leverage item in this document.

Addresses the P0 the audit filed as *"One primitive requires one assistant turn"*
([audit line 341](COMPUTER_USE_ARCHITECTURE_AUDIT_2026-07-31.md)).

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 11.1 | Isolate host. `isolated-vm` is the honest analogue of a fresh V8 isolate; `node:vm` is not a security boundary and must not be described as one | `codex-rs/code-mode-runtime/src/v8_init.rs:1–40` | new `src/code/` |
| 11.2 | `tools` global — every registered tool as an async JS function, names normalized to identifiers | `code-mode-runtime/src/runtime/globals.rs:36`, `:52`, `:122` | `src/code/globals.ts` |
| 11.3 | JSON Schema → TypeScript rendering so the model sees typed signatures | `code-mode-protocol/src/description.rs:449`, `:494` | `src/code/schema.to.ts.ts` |
| 11.4 | Output helpers: `text()`, `image()`, `exit()`, `notify()`, `yield_control()` | `code-mode-runtime/src/runtime/globals.rs:26–47` | `src/code/globals.ts` |
| 11.5 | `store()` / `load()` session-scoped scratch memory across exec calls | same, `:30–31` | `src/code/session.store.ts` |
| 11.6 | Cell model: `exec` yields at `yield_time_ms` returning a `cell_id`; a separate `wait` tool resumes or terminates | `code-mode-protocol/src/session.rs:26`, `:51`; `code-mode-runtime/src/cell_actor/mod.rs` | `src/code/cells.ts` |
| 11.7 | Per-call token budget (`max_output_tokens`, default 10k) so a loop cannot flood context | `code-mode-protocol/src/description.rs` (`DEFAULT_MAX_OUTPUT_TOKENS_PER_EXEC_CALL`) | `src/code/budget.ts` |
| 11.8 | First-line pragma `// @exec: {...}` parsing | `code-mode-protocol/src/description.rs:123`, `:164` | `src/code/pragma.ts` |
| 11.9 | `ALL_TOOLS` metadata array for deferred-tool discovery by filter | `code-mode-runtime/src/runtime/globals.rs:37`, `:70` | `src/code/globals.ts` |
| 11.10 | Governor integration: **every** nested call still crosses `src/governor/governor.ts`. A script must not become a governor bypass | — | `src/code/bridge.ts` |

**Exit gate:**
- a script issuing N nested tool calls produces N governor decisions and N receipts;
- a script cannot reach fs, net, or `process` except through governed tools;
- Phase 10 fixture set shows a measured turn reduction on multi-step tasks;
- a runaway script is terminable via `wait{terminate:true}` and cannot outlive its session.

**Risk: high.** This is the one item here that can regress safety if rushed. 11.10 is not optional —
build the governor bridge before the ergonomics.

---

### Phase 12 — Code mode over computer use, plus perception polish

Duration: 2–3 weeks. Depends on Phase 11.

This is where the turn-count number actually moves. `select all unread → archive each` becomes one
script instead of 2N turns.

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 12.1 | Expose native computer operations as nested tools inside the isolate | — | `src/tools/implementations/native.computer.tools.ts` |
| 12.2 | **Keep the transaction compiler.** It stays the checked fast path for the two verbs it has live-proven; scripts become a second route for everything it cannot express. Both remain reachable and the compiler is preferred when it applies — it carries preconditions, step-ID uniqueness, and one-window checks a script does not | — | `src/computer/native.transaction.compiler.ts` (unchanged), new route in `src/computer/execution.recipe.ts` |
| 12.3 | Preserve every existing refusal inside scripts: stale frames, unresolved occlusion, cross-task replay, recipient preflight. A script must not launder a stale handle | — | `src/computer/native.operation.contract.ts` |
| 12.4 | **DONE 2026-08-08.** `AXTitleUIElement` dereference — read `Title`/`Value`/`Description` off the referenced element when an element has no label of its own | `MacOS-Use/.../tree/service.py:384–390` | `AccessibilityEngine.swift` |
| 12.5 | Debounced watchdog: focus/structure notifications force a fresh read instead of serving a stale tree (50ms default) | `MacOS-Use/macos_use/agent/watchdog/service.py:36–45` | `native/.../AXEventTracker.swift` |
| 12.6 | **DONE 2026-08-08.** Flash prompt variant for GUI turns on small models, sharing one production/benchmark builder and backed by newest-state exact form compilation | `MacOS-Use/macos_use/agent/prompt/system_flash.md` | `src/cli/personas/computer.playbook.ts`, `src/computer/structured.goal.ts` |
| 12.7 | Computer-use doctor with remediation text per failed permission | Hermes `tools/computer_use/doctor.py` | `src/cli/commands/diagnostics.ts` |

**Exit gate:** measured ≥50% turn reduction on the Phase 10 form and menu fixtures — the master
plan's original criterion, finally falsifiable. If it does not hit 50%, report the real number
rather than restating the target.

**Exit result (2026-08-08): passed.** Same model and compatibility backend, 15 valid runs, none
discarded: form median 10 → 2 turns (−80%), menu 7 → 2 (−71%); completion 3/15 → 15/15. Raw record:
`benchmarks/cu-baseline/phase12.6-flash-structured-2026-08-08.json`.

**Risk:** medium. 12.3 is the one to get right; 12.2 should not be started until 12.3 has tests.

---

### Phase 13 — Prompt assembly and context

Duration: 2–3 weeks. Independent of 11/12 — can run in parallel.

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 13.1 | Wrap the existing prompt sections as named fragments that render. `base.persona.ts` keeps every string it has today — the GUI verb/surface heuristics at `:61–64`, the computer-turn tool lists, the persona split — and each becomes a fragment with an identity. This is an envelope around the current text, not a rewrite of it | `codex-rs/core/src/context/world_state/mod.rs:1–45` | new `src/prompt/` wrapping `src/cli/personas/base.persona.ts` (kept) |
| 13.2 | SHA1 per fragment with a versioned domain-separation prefix and length-prefixed components | `world_state/mod.rs:243–254` | `src/prompt/fragment.hash.ts` |
| 13.3 | `Known`/`Absent`/`Unknown` previous-section tracking so unchanged fragments are not re-emitted | `world_state/mod.rs:156–158` | `src/prompt/diff.ts` |
| 13.4 | Snapshot test per fragment — a prompt regression fails CI instead of surfacing as odd model behavior | `codex-rs/core/src/context/world_state/snapshots/` | `src/__tests__/prompt.fragments.test.ts` |
| 13.5 | Compaction as a first-class task with its own token budget, not only a reactive catch | `codex-rs/core/src/compact.rs:57`, `:144`, `:622`; `compact_token_budget.rs:26` | `src/memory/context.manager.ts` |
| 13.6 | Filter-safe summarizer preamble framing prior turns as source material, so the summarizer does not obey instructions inside what it summarizes | Hermes `agent/context_compressor.py:1–18` | `src/memory/context.manager.ts` |
| 13.7 | Historical section headings — never "Next Steps"/"Remaining Work", which a later turn reads as live instructions | Hermes `agent/context_compressor.py:9–12` | same |
| 13.8 | Iterative summaries (fold the previous summary in) and token-budget tail protection instead of fixed message counts | Hermes `agent/context_compressor.py:13–17` | same |
| 13.9 | Cheap tool-output pruning pre-pass before spending an LLM call on summarization | Hermes `agent/context_compressor.py:1058` | same |

**Exit gate:** measured prompt-token reduction per turn on the Phase 10 baseline; every fragment
snapshot-tested; no summary can inject an active instruction.

**Note on 13.2/13.3:** per
[bimax-stabilization-debts](../../.claude/projects/-Users-vishsiddharth-Desktop-Bimax/memory/bimax-stabilization-debts.md),
do not call this "lossless" unless the fragments are genuinely content-addressed. Hash-and-diff is
the mechanism that earns the word here — use it or drop the word.

**Risk:** low-medium. Mostly mechanical, with a real payoff in prompt-cache hit rate.

---

### Phase 14 — Safety and policy

Duration: 3–4 weeks.

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 14.1 | Guardian: a second model that risk-rates an action `low`/`medium`/`high`/`critical` against a written policy, separate from the deny decision | `codex-rs/core/src/guardian/review.rs:161`, `:293` | new `src/governor/guardian/` |
| 14.2 | Port the policy document structure — taxonomy sections, both-direction rules, an explicit outcome rule per section, `user_authorization` as an input | `codex-rs/core/src/guardian/policy.md` | `src/governor/guardian/policy.md` |
| 14.3 | Rejection circuit breaker so guardian cannot deny-loop within one turn | `codex-rs/core/src/guardian/mod.rs:96`, `:115` | `src/governor/guardian/breaker.ts` |
| 14.4 | Keep deterministic vetoes as the hard floor. Guardian is a second opinion on the ambiguous middle, never a replacement | — | `src/governor/governor.ts` |
| 14.5 | Declarative prefix rules over argv tokens, alternatives as nested lists, `decision` ∈ allow/prompt/forbidden, with `justification` | `codex-rs/execpolicy/src/rule.rs:16`, `:40`, `:46`, `:111` | `src/governor/policy.engine.ts` |
| 14.6 | `match`/`not_match` examples validated **at load time** — a policy that no longer means what its author meant fails to load | `codex-rs/execpolicy/README.md` | same |
| 14.7 | Host-executable pinning so `/usr/bin/git` cannot fall back to the `git` basename rule unless listed — closes PATH-shadowing | `codex-rs/execpolicy/README.md` (matching semantics) | `src/governor/bash.analyzer.ts` |
| 14.8 | Network rules (host + protocol) in the same engine | `codex-rs/execpolicy/src/rule.rs:118`, `:149`, `:156` | `src/governor/network.veto.ts` (new) |
| 14.9 | Full hook lifecycle: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, TurnStop, SessionEnd, PreCompact, PostCompact | `codex-rs/core/src/hook_runtime.rs:103`, `:163`, `:225`, `:264`, `:298`, `:369`, `:400`, `:437` | `src/tools/hooks.ts` |
| 14.10 | Context-injecting hooks — a hook may append context to the next model call | `hook_runtime.rs:598`, `:627`, `:641` | same |
| 14.11 | Hook output spill to file when a hook returns more than fits in context | `codex-rs/hooks/src/output_spill.rs` | `src/tools/hooks.loader.ts` |

**Exit gate:** guardian never overrides a deterministic veto; a malformed or self-contradictory
policy fails to load; network egress is policy-gated; all nine hook events fire with tests.

**Risk:** medium. 14.4 is the invariant that keeps this from being a safety regression.

---

### Phase 15 — Exec, evidence, verification

Duration: 2–3 weeks. Mostly independent; good parallel track.

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 15.1 | PTY sessions with approval → sandbox selection → run, and unsandboxed retry on denial **without re-prompting** (approval cached) | `codex-rs/core/src/unified_exec/mod.rs:1–23` | `src/terminal/multiplexer.ts` |
| 15.2 | Shared `is_likely_sandbox_denied` heuristic so denial messages are identical across every exec path | `unified_exec/mod.rs:9–10` | `src/sandbox/exec.sandbox.ts` |
| 15.3 | Head+tail capped buffer (50/50) with an explicit omission marker | `unified_exec/head_tail_buffer.rs:5`, `:114` | `src/terminal/queue.ts` |
| 15.4 | Cumulative per-turn unified diff built from applied deltas, no filesystem re-read | `codex-rs/core/src/turn_diff_tracker.rs:47`, `:92`, `:114` | new `src/core/turn.diff.ts` |
| 15.5 | Streaming patch parser — validate while the model streams, fail before it finishes writing | `codex-rs/apply-patch/src/streaming_parser.rs:22`, `:139` | `src/tools/implementations/edit.tool.ts` |
| 15.6 | Verify-on-stop gate: model tries to finish right after editing code with no fresh evidence → bounded follow-up. Policy-only; it never runs checks itself | Hermes `agent/verification_stop.py:1–8` | `src/sandbox/verify.loop.ts` + `src/review/verification.scope.ts` |
| 15.7 | Suppress the nudge for doc-only turns via a non-code extension set (`.md`, `.txt`, `.csv`, `LICENSE`…) — they shipped this and had to fix the README false positive | Hermes `agent/verification_stop.py:16–45` | same |
| 15.8 | Background review thread concurrent with the turn, auto-denying every side-effecting command the reviewer attempts | Hermes `agent/background_review.py:635`, `:655`, `:974` | `src/review/review.manager.ts` |
| 15.9 | Tool-call signature (canonicalized args → hash) + loop cap, returning a **synthetic tool result with a per-tool recovery hint** rather than a hard error | Hermes `agent/tool_guardrails.py:177`, `:225`, `:273`, `:510`, `:533` | `src/core/loop-detector.ts` |

**Exit gate:** a sandbox-denied command retries once without a second prompt; the turn ends with one
coherent diff; a code-edit turn with no evidence cannot silently finish; a doc-only turn is never
nudged; a repeated identical tool call gets a hint, not a wall.

**Risk:** low.

---

### Phase 16 — Model economics

Duration: 2–3 weeks.

| # | Work | Upstream ref | Target |
|---|---|---|---|
| 16.1 | **Auxiliary vision routing.** When the active model is text-only, route the screenshot through a vision model and hand the main model text, instead of dropping the image | Hermes `tools/computer_use/vision_routing.py:1–47` | `src/core/multimodal.ts:82–86` |
| 16.2 | Fail closed toward aux routing on missing/ambiguous capability metadata — returning an image to a model that cannot read it is a hard tool failure; one extra aux call is not | Hermes `vision_routing.py:43–47` | same |
| 16.3 | Explicit `supports_vision` override for local/custom OpenAI-compatible VLM routes absent from capability metadata | Hermes `vision_routing.py:31–34` | `src/cli/config.ts` |
| 16.4 | Mixture-of-Agents as a **slash command marking one turn**, not a model tool. The normal loop keeps owning tool calling and termination | Hermes `agent/moa_loop.py:1–8`, `:1161` | new `src/core/moa.ts` |
| 16.5 | Parallel reference calls with per-slot runtime/reasoning config and cache breakpoints | Hermes `agent/moa_loop.py:313`, `:382`, `:732` | same |
| 16.6 | Trimmed history for reference models — do not pay full context × N | Hermes `agent/moa_loop.py:598` | same |
| 16.7 | Graceful degradation: a dead advisor yields an explicit notice, never a blocked or poisoned turn | Hermes `agent/moa_loop.py:1130`, `:1155` | same |
| 16.8 | PII redaction on advisor output before it reaches UI, saved traces, or the aggregator prompt. Note the delimiter-required phone pattern — a bare 10-digit match mangles line numbers, SHAs, timestamps, and dotted quads in code-review text | Hermes `agent/moa_loop.py:24–52` | `src/utils/` redactor |
| 16.9 | Typed failover taxonomy (402/400 bodies, upstream provider extraction) layered **on top of** the existing HTTP-code buckets. `RetryPolicy.server()` and the key-rotation/cool-down behavior at `llm.adapter.ts:387`, `:491`, `:649` stay exactly as they are — the classifier only refines cases the buckets currently lump together, and falls through to today's behavior when it cannot classify | Hermes `agent/error_classifier.py:24`, `:1202`, `:1231`, `:1747` | new `src/core/error.taxonomy.ts`, consumed by `src/core/circuit-breaker.ts` (buckets kept) |

**Exit gate:** a text-only model completes a GUI fixture task end-to-end via aux vision; MoA
measurably improves a hard fixture task at a recorded cost delta; no advisor text reaches a trace
file unredacted.

**Risk:** low-medium. 16.1 is the highest-value item in this phase and is worth pulling forward if
Phase 11 slips — it is independent of code mode.

---

## 2.5 Preservation list

These already exist, several took live debugging to get right, and no phase above may weaken them.
Add this to the review checklist for every PR in Phases 10–16.

Computer use — the twelve differentiators in
[the audit's "What Bimax should preserve"](COMPUTER_USE_ARCHITECTURE_AUDIT_2026-07-31.md) still
stand in full. The ones most at risk from Phase 11/12 scripts specifically:

- exact `pid + windowId + frameId` ownership, not PID-only;
- refusal of stale raw coordinates and stale semantic handles;
- AX event epochs and semantic re-grounding when the tree changes;
- recipient preflight and refusal on unresolved occlusion;
- serialized physical input with held-button recovery;
- human takeover and safe release of outstanding input;
- structured receipts separating delivery, observation, postcondition, confidence;
- honest degradation when screenshot, AX, or ownership cannot be established;
- bounded recovery instead of unbounded retry.

Engine — the equivalents, each currently implemented and each at risk from a specific phase:

| Keep | Where | Threatened by |
|---|---|---|
| 9-tier fuzzy edit chain | `src/tools/implementations/edit.tool.ts:21` | 15.5 (add streaming parse *before* the chain, do not touch the chain) |
| Key-pool rotation, cool-down, real-status reporting | `src/core/llm.adapter.ts:387`, `:491`, `:649` | 16.9 |
| `RetryPolicy` presets and breaker semantics | `src/core/circuit-breaker.ts:361`, `:395` | 16.9 |
| Deterministic vetoes: fs, budget, bash analyzer, power | `src/governor/` | 14.1–14.8 |
| Existing Pre/PostToolUse hook contract and its callers | `src/tools/hooks.ts:15`, `:20` | 14.9 (add seven events, keep these two signatures) |
| Layered context management + reactive compaction fallback | `src/core/agent.loop.ts:629–631`, `:788` | 13.5–13.9 |
| GUI verb/surface/engineering-context heuristics | `src/cli/personas/base.persona.ts:61–64` | 13.1 |
| Transaction compiler's preconditions and one-window check | `src/computer/native.transaction.compiler.ts` | 12.2 |
| Backend/rollout/shadow triad | `src/computer/backend.ts`, `native.rollout.ts`, `native.shadow.comparison.ts` | 11, 12 |
| Loop detection | `src/core/loop-detector.ts` | 15.9 (add the hint, keep the detector) |
| Mind/evolution/genome substrate | `src/mind/`, `src/evolution/`, `src/genome/` | nothing here touches it — keep it that way |

Every phase's exit gate implicitly includes: **220+ suites still green, and no row above weakened.**
A phase that improves its own metric while dropping one of these has failed, not passed.

## 3. Sequencing

```
Phase 10 ─ measurement baseline (blocking)
   │
   ├─► Phase 11 ─ code mode core ──► Phase 12 ─ code mode over computer use
   │
   ├─► Phase 13 ─ prompt & context        (parallel)
   │
   ├─► Phase 14 ─ safety & policy         (parallel, after 11.10 lands)
   │
   ├─► Phase 15 ─ exec & verification     (parallel)
   │
   └─► Phase 16 ─ model economics         (parallel; 16.1 can jump the queue)
```

Rules:

0. **Additive only.** See the hard constraint at the top. Any phase that wants to remove an existing
   path stops and asks first — retirement is its own decision with its own evidence.
1. **Phase 10 before anything.** Every later claim needs a denominator.
2. **11.10 (governor bridge) before any code-mode ergonomics.** A script that bypasses the governor
   is a safety regression that will be very hard to walk back once the model has learned the habit.
3. **14.4 (deterministic vetoes stay the floor) is non-negotiable.** Guardian is a second opinion.
4. Phases 13, 15, 16 touch disjoint files and can be worked concurrently.
5. If only one thing gets done: **Phase 10, then 16.1, then Phase 11.** That ordering buys a
   measurement, an immediate cost win, and the structural change, in rising order of risk.

## 4. Out of scope

Carried forward from Phase 9 and still unclaimed — none of these are engineering tasks:

- external Developer-ID signing and notarization (blocks native routing on any local build;
  `service_not_signed` at `src/computer/native.service.client.ts:155`);
- signed staged cohorts;
- the 8-hour soak;
- two-stable-release retirement of the CUA compatibility path.

Phase 12's exit gate cannot be measured on the native path until signing lands. It **can** be
measured on the compatibility path, which is what the Phase 10 harness should target first.

## 5. Reference index

| Feature | Upstream | Bimax target |
|---|---|---|
| Code mode description/contract | `codex-rs/code-mode-protocol/src/description.rs:12`, `:123`, `:164`, `:252`, `:449` | `src/code/` |
| Code mode globals | `codex-rs/code-mode-runtime/src/runtime/globals.rs:15–48` | `src/code/globals.ts` |
| Code mode cells/session | `codex-rs/code-mode-protocol/src/session.rs:26`, `:51` | `src/code/cells.ts` |
| V8 JIT mode init | `codex-rs/code-mode-runtime/src/v8_init.rs:1–40` | `src/code/isolate.ts` |
| World state fragments | `codex-rs/core/src/context/world_state/mod.rs:1–45` | `src/prompt/` |
| Fragment hashing | `codex-rs/core/src/context/world_state/mod.rs:243–254` | `src/prompt/fragment.hash.ts` |
| Previous-section diff | `codex-rs/core/src/context/world_state/mod.rs:156–158` | `src/prompt/diff.ts` |
| Guardian policy | `codex-rs/core/src/guardian/policy.md` | `src/governor/guardian/policy.md` |
| Guardian risk levels | `codex-rs/core/src/guardian/review.rs:161` | `src/governor/guardian/` |
| Guardian breaker | `codex-rs/core/src/guardian/mod.rs:96`, `:115` | `src/governor/guardian/breaker.ts` |
| Execpolicy rules | `codex-rs/execpolicy/src/rule.rs:16`, `:40`, `:46`, `:111` | `src/governor/policy.engine.ts` |
| Execpolicy network rules | `codex-rs/execpolicy/src/rule.rs:118`, `:149`, `:156` | `src/governor/network.veto.ts` |
| Hook lifecycle | `codex-rs/core/src/hook_runtime.rs:103–465` | `src/tools/hooks.ts` |
| Hook context injection | `codex-rs/core/src/hook_runtime.rs:598`, `:627`, `:641` | same |
| Hook output spill | `codex-rs/hooks/src/output_spill.rs` | `src/tools/hooks.loader.ts` |
| Unified exec | `codex-rs/core/src/unified_exec/mod.rs:1–23` | `src/terminal/multiplexer.ts` |
| Head/tail buffer | `codex-rs/core/src/unified_exec/head_tail_buffer.rs:5`, `:114` | `src/terminal/queue.ts` |
| Turn diff tracker | `codex-rs/core/src/turn_diff_tracker.rs:47`, `:92`, `:114` | `src/core/turn.diff.ts` |
| Streaming patch parser | `codex-rs/apply-patch/src/streaming_parser.rs:22`, `:139` | `src/tools/implementations/edit.tool.ts` |
| Compaction task | `codex-rs/core/src/compact.rs:57`, `:144`, `:622` | `src/memory/context.manager.ts` |
| Compaction quality | Hermes `agent/context_compressor.py:1–18`, `:1058`, `:1221` | same |
| MoA loop | Hermes `agent/moa_loop.py:426`, `:598`, `:732`, `:1161` | `src/core/moa.ts` |
| MoA redaction | Hermes `agent/moa_loop.py:24–52` | `src/utils/` |
| Verify-on-stop | Hermes `agent/verification_stop.py:1–45` | `src/sandbox/verify.loop.ts` |
| Background review | Hermes `agent/background_review.py:635`, `:655`, `:974` | `src/review/review.manager.ts` |
| Tool guardrails | Hermes `agent/tool_guardrails.py:177`, `:273`, `:510`, `:533` | `src/core/loop-detector.ts` |
| Error taxonomy | Hermes `agent/error_classifier.py:24`, `:597`, `:1202` | `src/core/circuit-breaker.ts` |
| Vision routing | Hermes `tools/computer_use/vision_routing.py:1–47` | `src/core/multimodal.ts` |
| CU doctor | Hermes `tools/computer_use/doctor.py` | `src/cli/commands/diagnostics.ts` |
| AXTitleUIElement | `MacOS-Use/macos_use/agent/tree/service.py:384–390` | `AccessibilityEngine.swift` |
| AX watchdog debounce | `MacOS-Use/macos_use/agent/watchdog/service.py:36–45` | `AXEventTracker.swift` |
| Flash prompt | `MacOS-Use/macos_use/agent/prompt/system_flash.md` | `src/cli/personas/` |
