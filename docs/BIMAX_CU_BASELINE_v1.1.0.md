# Bimax-Cu measurement baseline — v1.1.0

Status: **FROZEN as the compatibility-executor denominator; the suite as recorded no longer prints
`Frozen baseline`** (corrected 2026-08-09 — see "The baseline" below). Phase 10 of
`BIMAX_UPSTREAM_HARVEST_PLAN_2026-08-02.md`, which that plan marks blocking for every phase after it.

The four `compatibility` rows below remain the usable denominator and are unchanged apart from the
form class, whose denominator drops from 6 to 5 once the one unattributed run is separated out. The
suite is disqualified from the `Frozen baseline` verdict because the harness failed to record an
executor for one run — which is a reason to distrust attribution for that suite, not only for that
row. Re-running the suite on the current harness would produce a fully attributed record.

Reproduce with one command:

```bash
npm run benchmark:cu-baseline -- --repeats 3
```

## Why this exists

The master refactor plan's headline success criterion is *"at least 50% fewer model/tool turns on
forms and menus"* (`BIMAX_CU_MASTER_REFACTOR_PLAN_2026-07-31.md` §24.2). It had never been measured.
`BIMAX_CU_PORTING_LEDGER.md:451` recorded that the turn-count gates "cannot honestly be measured
yet", and every later phase of the harvest plan claims a turn or token improvement against it. With
no denominator those claims could not be confirmed *or* refuted — they were unfalsifiable in both
directions. This document is the denominator.

## The baseline

Measured 2026-08-08 at commit `182cea7f`. Model `nvidia/nemotron-nano-12b-v2-vl` throughout, pinned
for the whole suite. macOS 26.5.2, arm64, Mac15,12, 8 GB. Backend: compatibility `ComputerTool`
(native routing is signing-gated off on this build). 3 runs per task, 15 valid runs total, none
discarded.

**Corrected 2026-08-09 — the executor split below supersedes the original table.** When Phase 2
made the report separate executors, replaying the committed raw record showed that 14 of the 15
valid runs carry `backend: "compatibility"` and **one — `form-checkbox` — records no backend at
all**. The original table pooled it into the form class and printed `form 6 | 2/6`, and the report
declared the suite a frozen baseline. The raw record is unchanged; only this reading is corrected.

| backend | task class | runs | completed | median turns | median tool calls | median prompt tokens | median wall clock |
|---|---|---|---|---|---|---|---|
| compatibility | form | 5 | 2/5 | 11 | 10 | 107844 | 89.7s |
| compatibility | menu | 3 | 0/3 | 7 | 6 | 58506 | 36.5s |
| compatibility | selection | 3 | 1/3 | 5 | 4 | 46990 | 58.9s |
| compatibility | transaction | 3 | 0/3 | 5 | 4 | 47693 | 23.2s |
| unattributed | form | 1 | 0/1 | 2 | 1 | 15691 | 6.3s |

Superseded original reading, retained so the change is auditable: `form 6 | 2/6 | 10 | 9 | 96508 |
67.5s`, with the other three classes as above.

The unattributed run was very probably compatibility too — native routing was signing-gated off on
this build, and the run made a single tool call before failing. It is deliberately **not** relabelled
as compatibility: the point of separating executors is that a run whose executor was never recorded
cannot be assigned to one afterwards by inference. It therefore stands as its own row, and this
suite no longer qualifies as a frozen baseline for the compatibility executor.

`turns` is model round-trips, counted inside the loop by `src/telemetry/task.metrics.ts`. That is
the number §24.2 is about. The raw per-run record is committed alongside this document as
`benchmarks/cu-baseline/frozen-v1.1.0.json`; ad-hoc runs write `baseline-<timestamp>.json`, which is
gitignored because a run is not evidence until it qualifies as frozen.

**Medians include failed runs, deliberately.** A median over only the successes reports the turn
cost of the tasks that happened to work, which is the flattering number. Any future comparison must
be graded the same way or it is not comparable to this table.

**Completion is 3/15 overall.** These are whole-system numbers — model, prompt, harness and
ComputerTool together — not a model score and not a runtime score. Most of the failures are the
model losing the thread across turns, not the runtime refusing anything.

## What this is NOT

- **Not a model-quality result.** Every number depends entirely on the configured model. A different
  model moves all of them, so no row here may be quoted without the model name attached.
- **Not the deterministic capability floor.** `scripts/benchmark-computer-tasks.ts` drives the same
  runtime from a perfect planner and has ZERO model turns by construction. It answers "can the
  machinery do this at all"; this answers "what does it cost a model to get it done".
- **Not the autonomy suite.** `benchmarks/autonomy` offline mode replays recorded trajectories and
  measures the harness. Its 1/7 → 7/7 is a harness self-test (`mode: offline-trajectory-smoke`) and
  must never be quoted as a model result.
- **Not native-path numbers.** This build runs the compatibility backend. When the native semantic
  route is enabled the baseline must be re-measured, not adjusted.

## Findings worth carrying forward

**The 40-row table contributes zero elements to the observation.** At `maxElements: 500` the fixture
window yields 18 elements and not one is a row. This is why the benchmark spec's "select table row"
task is absent from the suite: with no row in the payload there is no end state to read, and the
only available signal is the fixture's `last=select` counter, which cannot tell selecting Row 7 from
selecting Row 1. A radio group stands in for the selection class. This is a real perception gap and
is what Phase 12.4 (`AXTitleUIElement` dereference) targets.

**The AX tree intermittently comes back empty and the runtime substitutes OCR.** Those observations
carry `role: "VisualText"` with recognised text like `"Fixiure Cheekbox"` and `"esserO eventS-O
la5t=Mne"`. Grading against them is strictly worse than not grading — a checkbox has no readable
value in OCR at all — so the harness detects the fallback and discards the run rather than scoring
it. Two runs in this suite hit it and were re-run.

**Tool-call fidelity costs turns.** The loop logs `Repaired malformed <action> argument JSON before
execution` repeatedly for this model. Each repair is a turn that did not advance the task, and it is
part of why the medians sit where they do.

## Method notes that keep this honest

- Grading reads the fixture's own accessibility state fresh after the loop ends. The model's claim
  of success is never the evidence, and neither is the tool's `ok` field.
- Everything is graded on **end state**, never on "an event happened". An earlier grader accepted
  the fixture's `last=toggle` counter, and a run that toggled the checkbox twice — ending unchecked
  — scored PASS.
- `--self-test` runs every grader against a freshly launched fixture, where each task is by
  definition unfinished, and fails if any grader passes. It also aborts if the observation is the
  OCR fallback, because graders that return false because they saw *nothing* would otherwise sail
  through.
- Runs that measured nothing (provider outage, empty AX tree) are retried up to twice and, if still
  invalid, reported as discarded and excluded from every median. **Failures are never retried** —
  re-rolling those until they pass is how a benchmark starts flattering itself.
- The suite pins the work model through `BGW_MODEL`. Without that pin `LlmAdapter.heal()` re-points
  the work slot on provider failure and, because the value came from the global config scope, that
  change was persisted — an early run silently rewrote the user's saved model. A measurement harness
  must not mutate the thing it measures.

## How to compare against this later

Run the same command on the changed build, with the same model, and compare like against like:

```bash
npm run benchmark:cu-baseline -- --repeats 3
```

The report prints `Frozen baseline` only when one model was used throughout, **one attributed
executor produced every run**, no runs were discarded, and every class has at least 3 valid runs. A
run that prints `PROVISIONAL` is not a comparison point. If a change does not reach the §24.2
target, report the real number — the point of having a denominator is that the target can now be
missed out loud.

The executor condition was added in Phase 2 (`07_MIGRATION_ROADMAP.md`: "Run native and
compatibility baselines separately; never combine their numbers"). Rows are grouped by backend first
and a baseline is always a baseline **for one executor**, never for the product in general. A run
that recorded no backend becomes an `unattributed` row and disqualifies the suite rather than being
folded into a known executor.

## Qualified comparison after the action-envelope fix

Measured 2026-08-08 at commit `6641bb55`, after `02b456c6`. The run used the same
`nvidia/nemotron-nano-12b-v2-vl` model throughout, the compatibility backend, 3 runs per task, and
had zero discarded runs. Raw evidence:
`benchmarks/cu-baseline/post-envelope-fix-6641bb55.json`.

| task class | completed, before → after | median turns, before → after | median tool calls, before → after |
|---|---|---|---|
| form | 2/6 → **0/6** | 10 → 8 (−20%) | 9 → 7 (−22%) |

The `before` column here is the superseded pooled reading. On the corrected compatibility-only split
the form baseline is **2/5**, so the like-for-like comparison is 2/5 → 0/6. Both after-columns are
fully attributed to the compatibility executor; only the baseline's form denominator changed.
| menu | 0/3 → 0/3 | 7 → 5 (−29%) | 6 → 4 (−33%) |
| selection | 1/3 → 1/3 | 5 → 5 | 4 → 4 |
| transaction | 0/3 → **1/3** | 5 → 9 (+80%) | 4 → 8 (+100%) |

**Verdict:** the envelope normalization removes some wasted turns on forms and menus, but it does
not produce an end-to-end win by itself. Neither class reaches the 50% turn-reduction target, menu
completion remains zero, and form completion regressed in this sample. The earlier provisional
selection signal (1/3 → 3/3) did not reproduce; the clean comparison is unchanged at 1/3.

## Qualified comparison after the flash prompt and exact-state controller

Measured 2026-08-08 from the Phase 12.6 worktree. The same
`nvidia/nemotron-nano-12b-v2-vl` model ran throughout on the compatibility backend: 3 runs per task,
15 valid runs, zero discarded. Raw evidence:
`benchmarks/cu-baseline/phase12.6-flash-structured-2026-08-08.json` (SHA-256
`adeedf39dfec84c85efe8675770157194660baafc5a30bb94478e3070dbf0c5f`).

| task class | completed, baseline → after | median turns, baseline → after | median tool calls, baseline → after |
|---|---|---|---|
| form | 2/6 → **6/6** | 10 → **2** (−80%) | 9 → **2** (−78%) |

As above, the form `baseline` cell is the superseded pooled reading; the corrected
compatibility-only figure is **2/5**. The direction and size of this result are unaffected — 2/5 → 6/6
is if anything a slightly smaller starting point than 2/6 — but the corrected denominator is the one
to quote.
| menu | 0/3 → **3/3** | 7 → **2** (−71%) | 6 → **2** (−67%) |
| selection | 1/3 → **3/3** | 5 → **2** (−60%) | 4 → **2** (−50%) |
| transaction | 0/3 → **3/3** | 5 → **3** (−40%) | 4 → **3** (−25%) |

**Verdict:** the Phase 12 exit gate passes for both named classes. The graders were not relaxed:
exact text uses equality, toggles are graded on final value, and `--self-test` first proved every
untouched fixture state fails. The improvement comes from a compact small-model playbook, applying
exact user constraints after malformed-call repair, newest-snapshot-only handles, synchronous
AppKit pop-up selection, and stopping only when the newest AX values prove the requested state.
