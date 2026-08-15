# Model-independent strategy

## Goal

Bimax should remain useful when the best model changes, a provider is down, or a user chooses a
cheaper/local model. The harness must supply structure, state, verification, and recovery that the
model should not have to reinvent on every turn.

This is not a promise that all models produce equal reasoning. It is a promise that product
correctness is not silently delegated to one vendor's undocumented behavior.

## 1. Provider capability contract

Every model/provider route must be probed before it can power an autonomous task. Store a versioned
capability profile, not a brand-name assumption:

```ts
interface ModelCapabilityProfile {
  provider: string;
  model: string;
  streaming: boolean;
  nativeToolCalls: boolean;
  parallelToolCalls: boolean;
  vision: 'native' | 'auxiliary' | 'none';
  reasoningChannel: 'separate' | 'inline' | 'none';
  maxInputTokens: number;
  maxOutputTokens: number;
  supportsPromptCache: boolean;
  toolSchemaLimits: { maxTools: number; maxSchemaBytes: number };
  testedAt: string;
  probeVersion: string;
}
```

The probe suite must test real streaming, tool IDs, malformed arguments, tool-result continuation,
image handling, cancellation, rate-limit classification, context limit behavior, and recovery after
a failed call. A model picker can display “coding verified,” “vision via helper,” or “chat only.” It
must not let an incompatible route begin Computer Use and fail three turns later.

## 2. Task contract before model call

Convert each request into a task contract:

- desired outcome;
- explicit constraints and protected state;
- allowed capability lanes: code, browser, Mac;
- observable completion checks;
- approval points;
- time, spend, and iteration budgets;
- recovery/stop conditions.

The contract is durable task state. It survives compaction, app restarts, provider failover, and
model switching. Conversation prose can be summarized; the task contract cannot be replaced by a
summary's guess.

## 3. Typed plans and small tool surfaces

The active tool set should be compiled for the task. Do not send every Bimax capability on every
turn. Use a footprint ladder:

1. deterministic controller or existing tool;
2. skill/instruction;
3. capability-gated tool;
4. MCP/plugin;
5. new core tool only when broadly unavoidable.

Expose the smallest schema that can finish the next stage. This improves prompt caching, lowers
token load, reduces tool confusion on smaller models, and makes permissions intelligible.

For bounded multi-call work, add a sandboxed programmatic dispatcher similar in spirit to Hermes
`execute_code`: code can call eligible read-only or pre-approved tools, filter large results, and
return compact structured output. Each nested call still enforces its own permission.

## 4. Deterministic controllers for bounded work

Use state machines where the workflow is knowable:

- install/permission setup;
- git worktree creation and handoff;
- test → diagnose → patch → rerun;
- provider failover;
- application open/observe/action/verify;
- form filling with known fields;
- background delivery and focus restoration;
- update/rollback.

The model selects intent or interprets unexpected state. It should not decide whether a required
postcondition check can be skipped.

## 5. Independent verification

Execution and grading must be separate. A completed tool call is evidence of an attempt, not a
pass.

### Code lane

- targeted tests and full relevant suite;
- typecheck/lint/build where applicable;
- git diff and dirty-worktree preservation;
- optional read-only reviewer on the final diff;
- artifact hashes and command exit state.

### Mac lane

- observation captured after the action;
- target bundle/window identity;
- expected value/state derived independently of action success;
- focus/background classification;
- executor used: semantic, physical, visual recovery;
- stale-handle and frame checks;
- no success if the grader received no observable state.

The final receipt links each claim to its evidence object and age. “Sent message” without a fresh
conversation state is not allowed.

## 6. Typed failure taxonomy and changing retries

Classify failures before retrying:

- provider outage/rate limit/auth/model missing;
- invalid tool schema/tool call;
- permission denied or revoked;
- target app/window missing;
- stale observation/element handle;
- action rejected/no state change;
- postcondition mismatch;
- harness crash/protocol corruption;
- user interruption.

Retry only when the next attempt changes something meaningful: refresh state, switch executor,
narrow the target, ask for permission, fail over provider, or stop. Canonicalize tool arguments and
reject identical failed-call loops with a recovery hint.

Provider failover must preserve the user's configured default. A healed route is task-local unless
the user explicitly changes their settings. This prevents the previous harness bug that persisted a
fallback model into user config.

## 7. Auxiliary models without hidden dependence

Allow small dedicated routes for:

- vision description when the main model is text-only;
- context compression;
- read-only review;
- embeddings/search;
- task title generation.

Each auxiliary route is visible in the receipt and separately configurable. Missing or ambiguous
vision metadata should route to a known vision helper or stop; never drop the image and continue as
if the model saw it.

## 8. Crash-safe task ledger

Persist append-only task events with stable IDs:

- task/plan revisions;
- model calls and provider classification;
- tool request/result pairs;
- approvals;
- file/action evidence;
- checkpoints;
- subagent lineage/worktree;
- final/invalid/blocked terminal state.

On restart, reconcile running processes and worktrees, mark orphaned attempts, and offer Resume,
Inspect, or Roll back. Never replay a side effect merely because its result event was lost; first
inspect the real postcondition.

## 9. Performance independent of raw model speed

- Cache stable prompt fragments by content hash.
- Send diffs of unchanged world-state sections.
- Prune huge tool output before spending a model call on summarization.
- Parallelize independent read-only discovery.
- Keep action → observe → verify loops compact.
- Use semantic Accessibility actions before physical input; use visual recovery only when required.
- Track model latency separately from harness latency so infrastructure regressions are visible.

## 10. Model-tier release gate

Maintain three routes in CI/evaluation:

1. **minimum supported tool model** — cheapest/local route Bimax advertises for autonomous coding;
2. **balanced route** — recommended everyday model;
3. **frontier route** — strongest supported model.

A deterministic product feature is not ready if only the frontier route passes. Each task suite
sets its own threshold based on repetitions and risk; no global made-up “100% AI” number. Open-ended
quality may vary by tier, but safety, task-state integrity, permissions, receipts, rollback, and
grader correctness must be identical across all three.

## The moat

Models commoditize. A durable advantage is the growing collection of:

- real failure traces;
- exact task contracts and end-state graders;
- per-model conformance profiles;
- Mac app/window behavior fixtures;
- proven recovery policies;
- action/evidence receipts;
- safe, reusable workflow skills.

That dataset and harness can improve every supported model. It is more defensible than a prompt that
works only with today's strongest release.
