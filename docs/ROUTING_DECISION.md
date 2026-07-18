# Routing Architecture Decision — removing the pre-flight classifier (2026-07-18)

## Problem

After the key-cooldown root cause was fixed (commit `9b35658d`), first visible token
against a 120ms-TTFT mock provider was still ~1.85s. A timestamped turn trace
(`BIMAX_LLM_TRACE=1`) attributed it:

| phase | window | cost |
|---|---|---|
| input → routing dispatch | +0 → +81ms | 81ms |
| **remote classifier round-trip** | **+81 → +1254ms** | **~1.17s** |
| context assembly (vector search, prompt build) | +1256 → +1416ms | ~160ms |
| main call dispatch → first token | +1416 → +1803ms | ~390ms |

The classifier was a **non-streaming** lite-model completion — it paid for the
provider's *entire* response generation, not just TTFT, on every turn whose route the
local heuristic couldn't decide. Against real NIM this is worse, not better.

## What the classifier actually produced

1. A tier decision: `lite` (Quick model) vs `heavy` (Work model).
2. An optional one-line "task brief" prepended to heavy prompts (the Work model always
   also received the user's original prompt — the brief was framing, not information).

## Architectures compared

| # | Architecture | Verdict |
|---|---|---|
| 1 | Serial remote classification (status quo) | ~1.17s/turn tax; also a provider dependency in the routing path (its malformed response caused the key-cooldown bug). Rejected. |
| 2 | Parallel classification + main-call preparation | Already partially in place (overlapped @-mention expansion). The turn still blocks on the slowest leg — the classifier. Ceiling ≈150ms saved. Rejected. |
| 3 | Local deterministic routing for obvious cases | Already existed (`heuristicTier`). Kept, extended. |
| 4 | Local classifier + remote fallback | The remote leg re-introduces exactly the tail latency being removed, on exactly the turns that hit it. Rejected. |
| 5 | Optimistic Quick with escalation | Serves real work from the weak model first (observed live: quick model flails on tool loops, denies having tools), then pays double latency + cost to escalate. Quality-unsafe in the direction that matters. Rejected. |
| 6 | Default Work with later adaptation | Correctness-safe: the Work model handles everything Quick can; a misroute costs tokens, never quality. **Adopted as the ambiguity default.** |
| 7 | Capability-driven routing | The informative signals (will this turn need tools/repo context?) are visible in the prompt locally: paths, @mentions, code fences, repo-referring nouns, imperative verbs. **Adopted as the local signal set.** True mid-turn model switching rejected as a separate, riskier change. |

## Chosen design (synthesis of 3 + 6 + 7)

`src/cli/model.router.ts` — routing is now fully local, deterministic, and ~0ms:

1. Manual pin (`/tier`, Ctrl+T) wins outright.
2. Unified single-model setups skip routing entirely (unchanged).
3. `heuristicTier` decides obvious cases (chat → Quick; heavy verbs / code context /
   computer-use context / >600 chars → Work) — unchanged.
4. `localTier` (new) settles the remainder with deterministic detectors:
   general-imperative verbs and repo/tool signals → Work; short self-contained
   knowledge questions → Quick; **everything ambiguous → Work**.

The remote classifier, its 3s timeout, its FIFO cache, and the "task brief" are
removed. Routing can no longer time out, fail, spend a model call, or touch the
provider path at all.

### Anti-oscillation record

- What the **remote classifier (A)** handled correctly, preserved deterministically:
  short imperatives outside the heavy-verb list ("please rework the tokenizer") → Work;
  repo-referring questions ("what does the governor do here") → Work; self-contained
  knowledge questions → Quick. Its historical failure (malformed response crashed
  routing and cooled the API key) is pinned by `src/__tests__/keybilling.test.ts` and
  by a router test asserting routing never invokes `chatCompletion`.
- What the **shape fallback (B**, >140 chars → heavy**)** got wrong, now regression-tested:
  38-char "please rework the tokenizer to stream" was misrouted to Quick.
- Accepted trade-off: tokens like `http/2` read as path-like work signals → Work. The
  misroute direction is the safe one (costs tokens, never quality).

## Measurements (120ms-TTFT mock, `scripts/mock-provider.mjs`; engine at this commit)

First visible token, input→token, ms:

| cell | config | n | min | p50 | p95 | max |
|---|---|---|---|---|---|---|
| before (serial classifier) | split models, cold process | 5 | 1785 | 1817 | 1866 | 1866 |
| A | split models (Work≠Quick), cold process, local classifier engaged | 20 | 645 | 678 | 712 | 712 |
| B | unified (Work==Quick), cold process, routing skipped | 20 | 646 | 656 | 702 | 702 |
| C | split models, cold process, heuristic route (obvious heavy prompt) | 20 | 643 | 663 | 701 | 701 |
| D | warm process, turn 1 (caches cold) | 6 | 668 | 679 | 705 | 705 |
| E | warm process, turns 2–4 (caches warm) | 18 | 396 | 402 | 436 | 436 |

- Target "<1s against a 120ms mock" met in every cell; warm turns ~400ms.
- A ≈ B ≈ C confirms routing itself now costs ~0ms (the split/unified/heuristic paths
  are indistinguishable within noise).
- "Classifier enabled vs bypassed" in the old sense no longer exists — there is no
  remote classifier. Cells B (unified skip) and C (heuristic short-circuit) are the
  bypass-equivalents; cell A engages the full local classifier.
- Remaining cold-process cost (~650ms) bounds as: ~85ms pre-routing turn setup,
  ~160ms context assembly (vector search + prompt build), ~390ms main-call dispatch →
  first token (client construction + mock TTFT 120ms + stream delivery). Warm
  processes drop ~270ms of that (client + caches already built).

Reproduce: `node scripts/mock-provider.mjs 8901` then
`BGW_BASE_URL=http://127.0.0.1:8901/v1 BGW_API_KEY=mock BGW_MODEL=mock BGW_CAP_PLAIN_CONTENT=true node scripts/e2e-turn.mjs "stream test" --runs=20`.

## Follow-up measurement correction — 2026-07-18

The routing conclusion above remains valid (the serial classifier was removed and A≈B≈C still
shows local routing costs approximately zero), but the original residual-cost interpretation mixed
two different effects:

1. OpenAI-compatible streams begin with an empty `{role:"assistant"}` delta. BiMax counted that as
   provider output, so `/perf` put the mock's real 120ms generation wait in the render bucket and
   taught per-key latency from the empty preamble. First-payload detection now ignores role-only and
   usage-only frames; content, reasoning, tool-call fragments, or finish are meaningful payloads.
2. The model id `mock` is intentionally unknown to the capability table. Without
   `BGW_CAP_PLAIN_CONTENT=true`, the safety filter buffers its leading text until it can rule out
   opener-less reasoning. The ~402ms warm first-visible result therefore measured the unknown-model
   safety buffer, not a prompt-assembly floor. The local mock emits plain content, so the capability
   override belongs in the benchmark command above.

Four warm-process full turns against the same documented mock cadence (120ms TTFT, 25ms/token):

| configuration | warm BiMax overhead | provider wait | payload→visible | warm first visible |
|---|---:|---:|---:|---:|
| `mock`, capability undeclared | ~10ms | ~125–126ms | ~258–262ms | ~394ms |
| `mock` + `BGW_CAP_PLAIN_CONTENT=true` | ~10–12ms | ~127ms | ~0ms | ~137–138ms |

This closes the proposed prompt-assembly-cache follow-up: steady-state assembly is already about
10ms on this workload, so a cache would add invalidation risk without addressing the measured floor.
