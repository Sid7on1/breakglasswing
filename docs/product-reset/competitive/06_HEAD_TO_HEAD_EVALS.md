# Head-to-head evaluations

## Purpose

These evaluations answer one question: does Bimax produce a better user outcome on the same work?
They are not model benchmarks, demo scripts, or a way to turn every green unit test into “n/n.”

## Evaluation tracks

### Track A — same-model harness comparison

Use the same exact model/provider route in Bimax, Hermes, and OpenCode where supported. This isolates
the agent harness. Record any product-specific prompt/tool constraints. Claude Code, Cursor, and
OpenAI-native product routes belong in Track B when the same model cannot be selected honestly.

### Track B — product-native comparison

Use each rival's normal recommended route. This answers what a user experiences, but it cannot prove
the Bimax harness is better independent of model. Report it beside Track A, never merged with it.

### Track C — Bimax model-tier resilience

Run the same Bimax build on the minimum supported tool model, balanced route, and frontier route.
This is the release gate for “regardless of model” infrastructure.

## Required journeys

| ID | Journey | Main rivals | Exact final state |
|---|---|---|---|
| C01 | Repair a failing test in a dirty repo | Claude Code, Codex, OpenCode, Hermes, Cursor | Target test and relevant suite pass; unrelated dirty file byte-identical |
| C02 | Implement a three-part feature in parallel | Codex, Claude, Cursor, Hermes, Zed | All acceptance tests pass; no merge conflict; isolated work visible and reviewable |
| C03 | Review an existing branch without editing | Codex, Cursor, Claude, Hermes, Zed | Prioritized findings cite real lines; working tree hash unchanged |
| C04 | Interrupt, crash, and resume | All coding rivals | No duplicated side effects; plan/evidence restored; user can inspect or roll back |
| C05 | Provider outage during a task | Hermes, OpenCode | Run invalidated or visibly failed over; user config unchanged; task state intact |
| M01 | Operate Messages against a safe fixture/test account | ChatGPT/Codex CU, Hermes CU | Exactly one intended message/draft in intended conversation; no other contact touched |
| M02 | Background Mac action while user stays in another app | ChatGPT/Codex CU | Exact app state achieved; zero unintended foreground/focus transitions |
| M03 | Change a setting and verify it after reopening | ChatGPT/Codex CU, Hermes CU | Persisted value survives close/reopen; receipt contains fresh observation |
| X01 | Fix code, launch app, click through, prove behavior | OpenAI/Cursor cloud agents | Code tests pass and real GUI postcondition passes in one task receipt |
| I01 | Fresh-Mac install and first code task | Desktop competitors | User reaches successful task with counted steps, prompts, restarts, and no hidden shell setup |

Detailed human-facing scripts live in `examples/`.

## Run record

Every attempt writes one immutable JSON record:

```json
{
  "schema_version": "1.0",
  "task_id": "M02",
  "fixture_version": "sha256:...",
  "product": "bimax-desktop",
  "product_version": "...",
  "build_hash": "...",
  "model_provider": "...",
  "model": "...",
  "capability_profile_hash": "...",
  "machine": { "model": "...", "os": "...", "arch": "arm64" },
  "initial_state_hash": "...",
  "started_at": "...",
  "ended_at": "...",
  "outcome": "pass",
  "invalid_reason": null,
  "human_interventions": 0,
  "approval_prompts": 1,
  "model_turns": 3,
  "tool_calls": 6,
  "identical_failed_calls": 0,
  "foreground_transitions": [],
  "config_before_hash": "...",
  "config_after_hash": "...",
  "evidence": [],
  "grader": { "version": "...", "mutant_checks_passed": true }
}
```

Store referenced screenshots, logs, diffs, observations, and receipts by content hash. Redact
secrets and personal message content before a record leaves the evaluation Mac.

## Validity rules

A run is invalid, not failed, when:

- the provider has a confirmed outage or request never reached the model;
- the grader cannot observe the end state;
- the fixture leaked state from a prior task;
- the product/model/build differs from the declared run;
- a permissions prompt was dismissed by unrelated user activity;
- the app or test account is unavailable before the first product action;
- required raw events or hashes are missing.

A product failure remains a failure when it caused the bad state: wrong app/contact, repeated action,
stale observation, crash, corrupted config, false completion, timeout after valid start, or inability
to recover.

## Grader requirements

Each grader must pass mutation tests before it can score real products. At minimum:

- expected state passes;
- unchanged state fails;
- double-toggle or duplicate-send fails;
- wrong target fails;
- stale prior-task state fails;
- empty/missing observation fails;
- provider error cannot be parsed as task success;
- result cannot be inferred only from the agent's final text.

This directly prevents the earlier Bimax baseline traps: vacuous grading, double-toggle acceptance,
fixture leakage, and provider outages scored as model failures.

## Ranking rules

Use lexicographic outcome ranking, not a blended vanity score:

1. exact success rate with confidence interval;
2. destructive/wrong-target incident count;
3. false-success count;
4. human interventions and approval prompts;
5. recovery rate after injected failure;
6. foreground/focus disruption for background tasks;
7. wall-clock p50/p95;
8. model turns, tool calls, tokens, and estimated cost;
9. evidence completeness and freshness.

A faster failure never beats a slower success. A one-off 1/1 run cannot establish a win. Repetition
counts are set per task before running; risky Mac actions use at least 20 clean repetitions per
build/model/executor path before a release claim.

## Win language

Bimax may say it wins one journey only when:

- both products ran a valid comparison track;
- the exact outcome rate is statistically credible for the chosen sample;
- Bimax has no additional wrong-target or false-success incidents;
- all raw attempts and discard reasons are preserved;
- the claim names task, version, model route, machine, date, and denominator.

Allowed example:

> On M02 v3, Bimax Desktop 1.0-alpha completed 19/20 valid runs without a foreground transition on
> macOS 15.6, versus Product X 16/20, using the same fixture and declared routes. One additional
> Bimax provider-outage attempt was discarded before model execution.

Not allowed:

> Bimax has better computer use.

## First benchmark order

1. Rerun the envelope-fix before/after comparison from the frozen CU handoff with a healthy
   provider. Do not quote the old invalid comparison.
2. Run C01 on Bimax, Hermes, and OpenCode using the same provider/model.
3. Run M02 on the packaged Bimax app and ChatGPT/Codex Computer Use, recording every foreground
   transition.
4. Run C04 crash/resume before adding more autonomy features.
5. Run X01 only after the app-only CU boundary is complete.

## Release dashboards

Publish separate panels:

- coding reliability;
- native Mac reliability;
- browser reliability;
- install/recovery;
- model-tier resilience;
- invalid runs/provider health.

Never combine the qualified 15/15 structured CU fixture with arbitrary native-app tasks into one
computer-use percentage.
