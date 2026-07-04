# BiMax v2 — "Ledger Mind" Architecture
### A redesign to survive competitors who have the same models, more money, and more people

---

## 1. Executive Summary

The previous review found one structural truth: **BiMax's original ideas are correct, and their implementations are counters, regexes, and JSON files.** Every weakness traces to four root causes:

1. **No single source of truth** — seven singletons writing debounced JSON files; no merging, no history, no rollback, no attribution dimensions.
2. **No causality** — claims resolved by time windows, corrections captured by regex openers, habits mined across task boundaries. Signals exist; *attribution* doesn't.
3. **No enforcement** — security is lexical analysis and an LLM guarding an LLM; autonomy (dream mode) runs with the user's full ambient authority.
4. **No measurement** — the system that measures the agent never measures itself.

The redesign rests on five load-bearing decisions, everything else follows:

- **D1 — The Ledger:** one append-only, content-addressed event log per repo (SQLite/WAL) + one global per user. Every mind-layer "database" becomes a *materialized view* that can be rebuilt, rolled back, and audited. Learning becomes reproducible by construction.
- **D2 — Local embeddings as infrastructure:** a bundled quantized embedding model (ONNX, ~30MB, CPU, no API) replaces every regex/string-match heuristic that was actually a semantic-similarity problem in disguise. BiMax already runs ONNX locally (Headroom); this reuses that muscle without violating the no-more-API-spend constraint.
- **D3 — Capabilities, not vetoes:** the Governor stops being a string-analyzing bouncer and becomes a **capability issuer**; enforcement moves to the OS (Seatbelt/Landlock). Provenance (taint) labels on context determine which capabilities a tool call may receive.
- **D4 — Statistics, not thresholds:** every magic number becomes a posterior; every decision becomes "act when P(effect) > τ with stated τ"; every learned behavior is a *policy* evaluated counterfactually before it earns prompt tokens.
- **D5 — Evals as the gate:** no learned artifact (routing hint, habit, preference, calibration escalation) enters the prompt without passing offline policy evaluation on the ledger, and no feature ships without an ablation. The eval harness runs on **recorded** LLM traffic (replay) — zero marginal API cost.

The moat this creates: **accumulated, causally-attributed, per-repo/per-user/per-model experience that provably improves outcomes, running entirely locally.** Competitors with identical models can copy any single mechanism in weeks; they cannot copy a user's two-year ledger, and — critically for the model vendors — their business models resist "local-first, provider-agnostic, your-data-never-leaves" as a core identity.

---

## 2. New System Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  FRONTENDS         Go TUI ── generated protocol types ── print/CI  │
├────────────────────────────────────────────────────────────────────┤
│  SESSION LAYER     bimaxd (per-repo daemon, single ledger writer)  │
│                    sessions = clients; leases; offline-first       │
├──────────────┬───────────────────┬─────────────────────────────────┤
│  AGENT CORE  │  MIND (views)     │  DREAM ORCHESTRATOR             │
│  loop, plan, │  self-model       │  task gen · curriculum ·        │
│  taint ctx,  │  calibration      │  sandboxed episodes ·           │
│  tool exec   │  user model       │  grading · distillation         │
│              │  drives · habits  │                                 │
├──────────────┴───────────────────┴─────────────────────────────────┤
│  THE LEDGER   append-only events (SQLite WAL) · HLC timestamps ·   │
│               materialized views · counterfactual log · episodes   │
├────────────────────────────────────────────────────────────────────┤
│  SUBSTRATE    capability broker + OS sandbox (Seatbelt/Landlock)   │
│               local embeddings (ONNX) · tree-sitter fleet ·        │
│               incremental graph store · test-dependency map        │
└────────────────────────────────────────────────────────────────────┘
```

**Why superior:** every subsystem that previously owned private state now *derives* state from the Ledger; every subsystem that previously enforced policy now *requests capabilities* from the broker. Two invariants — "all state is events" and "all authority is capabilities" — eliminate entire bug classes (races, stale learning, ambient authority) instead of patching instances.

---

## 3. Module-by-Module Redesign

For each module: **W** current weakness → **A** new architecture → **S** why superior → **X** complexity → **M** migration.

### 3.1 Persistence → The Ledger

**W:** Seven JSON singletons, debounced `writeFileSync`, concurrent-session data loss, no model/repo/prompt dimensions, no rollback, `process.once('exit')` flush hacks.

**A:** `src/ledger/` — one SQLite database per repo (`.bimax/ledger.db`, WAL mode) + one global (`~/.bimax/ledger.db`).

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY,          -- local monotonic
  hlc        TEXT NOT NULL,                -- hybrid logical clock (merge across machines)
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- tool_outcome | claim | evidence | diff_decision |
                                           -- correction | drive_measure | episode | policy_active |
                                           -- prompt_render | model_ctx | view_checkpoint ...
  entity     TEXT,                         -- e.g. "EditFileTool", claim id, drive id
  payload    BLOB NOT NULL,                -- msgpack, schema-versioned
  parent     INTEGER,                      -- causal parent event (attribution chains)
  hash       TEXT NOT NULL                 -- content hash (dedupe, replay integrity)
);
```

Rules: (1) only `bimaxd` writes; sessions submit over a local socket, buffer locally when the daemon is unreachable, and reconcile by HLC on reconnect. (2) Views (`self_model_view`, `calibration_view`, …) are pure folds over events with checkpointed snapshots every N events — corrupt view? delete it, refold. (3) **Every event carries the active context:** model id, prompt-template hash, mode, provider. This single change fixes the model-segmentation flaw fatally identified in review: stats are *conditioned* by construction.

**S:** merges concurrent sessions; enables rollback of bad learning (`view AS OF seq`); makes every experiment reproducible; turns "learning" from mutation into data.
**X:** 6 wks (2 for core, 2 for view framework, 2 for daemon/lease/offline).
**M:** each existing singleton gets a shim: `record()` → emit event; `report()` → query view. Old JSON files imported once as synthetic events (`kind: legacy_import`). Delete the singletons after two releases.

### 3.2 Tool contract → structured outcomes

**W:** `classifyOutcome` regex over result strings; tools signal failure by prose.

**A:** extend `BuiltTool` (in `tool.factory.ts`): tools return
```ts
{ status: 'ok'|'error'|'rejected'|'blocked',
  errorClass?: 'not_found'|'syntax'|'ambiguous_match'|'permission'|'timeout'|'external'|...,
  text: string, evidence?: EvidenceRef[] }
```
The agent loop serializes `text` to the model (unchanged wire behavior) and emits the *typed* outcome to the Ledger. A one-week sweep over `src/tools/implementations/*` converts every `return \`Error: ...\`` into a typed return; the regex classifier remains only as a fallback for MCP tools (whose output BiMax doesn't control), explicitly tagged `confidence: low`.

**S:** ground-truth labels for the entire learning system; the regex ceases to be a load-bearing wall and becomes a labeled edge case.
**X:** 1.5 wks. **M:** additive field; old signature still compiles.

### 3.3 Self-Model → hierarchical Bayesian reliability (see §4.1 for math)

**W:** counts + `n≥6, rate≥0.3` magic numbers; extension-as-domain; no model conditioning; 40-sample window.

**A:** `src/mind/self.model.ts` becomes a view over `tool_outcome` events with a **partial-pooling hierarchy**: global → tool → tool×language → tool×language×repo → ×model. Recency handled by Bayesian change-point detection instead of a fixed window. Routing hints become a **policy** (§8) that must pass offline evaluation before injection.

**S/X/M:** conflations (model swap, repo difficulty, small n) dissolve into the hierarchy; 3 wks on top of the Ledger; the prompt-block API is unchanged so `base.persona.ts` doesn't move.

### 3.4 Epistemic Ledger → causally scoped attribution

**W (the fatal one):** any evidence within 15 minutes resolves all open claims — calibration converges to biased noise.

**A:** claims and evidence become events linked through the **Test-Dependency Map (TDM)**, a new substrate service (`src/substrate/tdm.ts`):

- TDM = bipartite graph *source file ↔ verifying checks*, built from three sources of decreasing confidence: (1) coverage data when a coverage run exists, (2) `jest --findRelatedTests`/`vitest related`/`go list -deps` (you already built RelatedTestsTool — now it's load-bearing), (3) import-graph reachability from the code graph.
- Evidence resolves a claim with weight `w = P(check verifies file)` from the TDM (1.0 for coverage-confirmed, 0.7 related-tests, 0.3 import-reachable, **0 otherwise** — unrelated builds no longer touch the claim).
- Typecheck evidence is scoped by *error file paths*: a `tsc` failure in `a.ts` refutes only claims touching `a.ts` or its import ancestors.
- Multi-edit disambiguation: when a red check covers several open claims, resolution is **fractional** (soft labels) unless a subsequent bisecting event (one file reverted, check green) sharpens it — the loop already observes those events naturally.
- Unresolvable claims *expire into a separate "unobserved" population* and are reported as coverage-of-verification, itself a drive ("X% of your edits are never verified by anything — that's a testing gap, not a calibration gap").

Calibration is computed by **isotonic regression** on (stated confidence → weighted outcome) with Wilson intervals per bin; escalation triggers on **ECE contribution** per domain, not a gap threshold (§4.2).

**S:** the calibration curve becomes meaningful; the panel's worst criticism dies. **X:** 4 wks (TDM 2, scoped resolution 1, calibration stats 1). **M:** old `epistemic.json` discarded (its labels are known-biased — deliberately *not* imported).

### 3.5 User Model → embedding retrieval + assertion store

**W:** 4-feature Naive Bayes; regex correction capture; no decay/contradiction handling.

**A:** two components:

1. **Diff taste:** every approved/rejected diff is embedded locally (diff text + summary, bundled ONNX model). At proposal time, k-NN over past decisions; warning shown when the rejection-mass among neighbors within cosine radius r exceeds a calibrated threshold *and* retrieved neighbors are displayed ("similar to the auth-refactor diff you rejected Tue") — evidence, not vibes. Falls back to the 4 features only when the corpus is < 20 decisions.
2. **Preference assertions:** corrections become *candidate assertions* extracted at end-of-turn by the **lite model that is already processing the turn** (one extra instruction in the existing self-critic pass — zero additional API calls): `{assertion, scope, polarity, source_span}`. Candidates start at low confidence; they're **confirmed by consequence**, not by capture: each future turn where the assertion was active and the user did *not* correct that behavior is weak positive evidence; a contradicting correction is strong negative evidence (Beta posterior per assertion). Contradiction detection = embedding similarity between assertions with opposite polarity → surfaced to the user to resolve ("You said 'always add tests' in repo A and 'stop adding tests' here — repo-scoped?"). Assertions decay toward the prior unless re-evidenced (drift handling for free).

**S:** captures corrections regardless of phrasing; preferences carry uncertainty, scope, and lifecycle. **X:** 3 wks. **M:** existing standing prefs imported as candidates at confidence 0.5.

### 3.6 Habit Compiler → episode mining + executable macros

**W:** n-grams across task boundaries; "compiler" that emits markdown; prompt hints only.

**A:** three stages, honest names:

1. **Episode segmentation:** the Ledger already contains task boundaries (todo lifecycle, user turns, mode switches). Mining runs *within* episodes only.
2. **Pattern mining:** PrefixSpan (sequential pattern mining with gap constraints ≤ 2, min support across ≥ 5 distinct episodes, closed patterns only) over typed tokens `(tool, langClass, outcome)`. This kills the cross-task junk and the "obvious pair" noise the review flagged.
3. **Compilation — real this time:** a mined pattern becomes a **macro**: parameterized steps with typed slots (`$FILE`, `$PKG`), *preconditions* (file exists, tool available), *postconditions* (exit 0, check green), executed **by the harness deterministically** — no model round-trips — surfaced to the model as a single callable tool (`HabitTool: build-and-test-go`). Slot filling from the triggering context; any precondition failure aborts to the normal loop. Promotion gate: a macro must win its offline eval (does the deterministic path succeed at least as often as the modeled path it replaces?) before registration; demotion is automatic on two consecutive postcondition failures (events, so it's auditable).

**S:** habits now *save tokens and latency* measurably instead of asking the model nicely. **X:** 4 wks. **M:** existing habit files retired; miner refolds from ledger history.

### 3.7 Drives → declarative, learned setpoints, WIP-aware

**W:** hardcoded thresholds; "57 uncommitted paths" nagging during active work; no user configuration.

**A:** `.bimax/drives.yaml` (user-editable, schema-validated) defines drives as `{measure: cmd|builtin, direction, cadence, scope}`. Setpoints default to **learned robust baselines**: median ± k·MAD over the drive's own measurement history in this repo (a repo that normally has 40 TODOs isn't "deviating" at 45). Deviation requires **persistence** (CUSUM across ≥ 3 measurements, §4.3) and **non-WIP scope** (paths under active edit this session — known from the ledger — are excluded from hygiene drives). Suppression is a first-class verb (`/drives snooze tree-hygiene 2d`, an event).

**X:** 2 wks. **M:** current five drives become the default YAML; `drives.json` state re-derived.

### 3.8 Security → capability broker + OS sandbox + taint (full design §6)

### 3.9 Graph engine → incremental, shardable, SQLite-backed

**W:** JSON persistence; no incremental re-index; dies at monorepo scale.

**A:** graph nodes/edges in SQLite (same file family as the ledger, separate DB); **merkle tree over directory hashes** for staleness — a file save invalidates one leaf, re-parse via tree-sitter for that file only (< 10 ms typical), edges patched in place. Shards = top-level directories, lazily loaded, LRU-evicted; queries fan out only to loaded shards with an explicit "unindexed shards exist" flag in results so the model knows the answer may be partial (feeds honesty). Million-file repos: index-on-demand per shard + background fill, bounded by an I/O budget. Codemem stays as the semantic layer; the native graph becomes the always-fresh structural layer.

**X:** 5 wks. **M:** one-time import of `playground.json`; `GraphStore` API preserved.

### 3.10 Orchestration → durable pipelines

**W:** `worker_threads` + 10-min watchdog; pipelines die mid-step with undefined state; no resume; no cross-agent conflict handling.

**A:** every pipeline (`/beast`, heal, swarm, dream) becomes a **journaled state machine**: steps declared with idempotency keys, each transition an event; crash recovery = refold journal, resume at last incomplete step (worktrees are reattachable by branch name — they already survive the crash). Concurrency: **file claims** — an agent leases path globs before mutating; conflicting leases queue or trigger AST-level conflict check (both edits touch disjoint symbols → allowed; same symbol → serialized). Workers get heartbeats (extend existing ping/pong) instead of a single timeout; a stalled worker is snapshotted (its transcript is already event-logged) before termination so the step is *resumable, not just retryable*.

**X:** 5 wks. **M:** wrap existing TestHealer/Swarm call sites in the journal API first (they keep working), then move dream mode onto it.

### 3.11 TUI/protocol → generated contract

**W:** Go structs hand-mirror TS interfaces; drift is inevitable; `🧠` chip is opaque.

**A:** one schema source (TypeBox/JSON-Schema in `src/protocol/schema/`), codegen → TS types + Go structs + contract tests both sides run in CI. UX: the mind strip becomes *explainable* — clicking/entering the chip opens the existing dashboard component rendering "why": top weak spot with n and CI, the drive that's deviating with its sparkline (data all present in views). First-run tooltip explains the chip once.

**X:** 2 wks. **M:** generate current shapes first (zero behavior change), then evolve.

### 3.12 Context engine

**W:** Headroom ONNX proxy is complexity debt delivering ~0–15%.

**A:** kill the proxy path (keep the venv machinery for the embedding model); keep the lossless native log-collapse (measured 46%). Add **experience-aware context**: retrieved episodic exemplars (§9.3) enter the context *instead of* generic instruction text where applicable, net-neutral or negative token delta, measured by the eval spine.

---

## 4. Algorithms (the mathematics replacing every heuristic)

### 4.1 Self-model: hierarchical Beta-Bernoulli with change-point-aware forgetting

Outcome of call *i* in cell *c* (tool × langClass × repo × model): `y_i ~ Bernoulli(θ_c)`. Partial pooling: `θ_c ~ Beta(κ·μ_parent, κ·(1−μ_parent))` up the hierarchy (parent = drop the most specific dimension). Practical inference: empirical-Bayes shrinkage — cell posterior `Beta(α₀+s, β₀+f)` where `(α₀,β₀)` come from the parent's posterior moments, κ fit by maximum marginal likelihood monthly (a view job). Small-n cells inherit the parent; large-n cells dominate their prior. **No `n≥6` magic number:** a "weak spot" is `P(θ_c < θ_parent − δ) > 0.9` with δ = 0.15 declared in config, computed from the posterior — a probability statement, not a threshold on a point estimate.

Forgetting: Bayesian Online Change-Point Detection (BOCPD, Adams & MacKay) per cell with hazard `1/200`; on detected change (e.g., model swap, repo refactor) the run-length distribution resets the effective sample — principled recency without a 40-sample cliff. Model swaps also *hard-condition* (new model = new cell), so BOCPD handles the unmodeled drifts (repo phase changes, prompt updates).

Confidence for the calibration ledger: `confidenceFor = E[θ_c]` from the posterior — now honest by construction.

### 4.2 Calibration: isotonic regression + ECE decomposition

Weighted resolved claims `(p_i, y_i, w_i)` (w from TDM scoping). Reliability curve via **isotonic regression** (PAV algorithm) — monotone, non-parametric, no bin-boundary artifacts. Per-domain **Expected Calibration Error** with weights; escalation fires when a domain's ECE contribution exceeds its bootstrap 95% CI above zero *and* the direction is overconfident. Escalation itself is a policy (§8) — it must show it reduces regression-escape rate to stay on.

### 4.3 Drives: robust baselines + CUSUM persistence

Setpoint: `median ± k·MAD` over trailing history (k=3 default, per-drive overridable). Deviation alarm: one-sided **CUSUM** on standardized measurements, `S_t = max(0, S_{t−1} + (z_t − k_slack))`, alarm at `S_t > h` — a spike doesn't nag; a sustained drift does. Both k and h in the YAML with sane defaults; every alarm is an event carrying the statistics that fired it.

### 4.4 Routing/hints: contextual bandit with counterfactual gating

Each candidate prompt intervention (a routing hint, an escalation rule, a habit macro advertisement) is an **arm**. Context: task type, cell posteriors, repo. Reward: composite outcome score of the affected episode (verified success, token cost, user correction absence). Policy: Thompson sampling over a logistic reward model per arm. Crucially, BiMax logs **propensities** (`policy_active` events record which arms were shown and P(shown)), enabling **off-policy evaluation** (self-normalized IPS / doubly-robust) so any policy change is evaluated on *historical* traffic before deployment — zero extra API spend, the eval constraint satisfied by design.

### 4.5 Habit mining: PrefixSpan with closure and support windows

Closed sequential patterns, gap ≤ 2, support ≥ 5 episodes and ≥ 3 distinct days (blocks single-marathon artifacts). Candidate → macro only if slot inference succeeds (parameters unify across ≥ 80% of supporting instances) and postconditions are checkable. Elevation gate: offline replay estimate of `P(postcondition | macro) ≥ P(success | modeled sequence)` with a one-sided binomial test at α = 0.05.

### 4.6 Diff taste: calibrated k-NN

Warning score = kernel-weighted rejection mass among neighbors (cosine, bandwidth by median heuristic), calibrated to a probability by isotonic regression on held-out decisions; warn at `P(reject) > 0.6`. Cold start < 20 decisions: fall back to the coarse features, labeled as low-confidence in the UI.

---

## 5. Data Models

Beyond the `events` table (§3.1):

- **Views:** `view_state(view, key, value, as_of_seq)` — snapshot rows; folds are deterministic TS functions versioned by hash; changing a fold bumps its version → automatic refold (this is *rollback of bad learning*: revert the fold or the events, never hand-edit state).
- **Episodes:** `episode(id, kind: user_task|dream|heal, start_seq, end_seq, bundle_hash)`; the **bundle** is a content-addressed archive of every LLM request/response + tool I/O in the episode → deterministic replay (§7) and the "black-box recorder" (§9.5).
- **TDM:** `covers(check_id, path, weight, source: coverage|related|import, as_of_commit)`.
- **Assertions:** `assertion(id, text, embedding, scope, polarity, alpha, beta, status: candidate|confirmed|contradicted|retired)`.
- **Capabilities:** `grant(principal, caps[], scope, ttl, provenance_ceiling)` — audit-logged as events.
- **Macros:** `macro(id, steps[], slots[], pre[], post[], elo, status)`.

All payloads msgpack with explicit schema version; migrations are new folds, never in-place mutation.

---

## 6. Security Architecture

**Threat model.** Adversary: expert prompt-injection researcher controlling any *untrusted content channel* — repo files (comments, README), web pages, MCP tool outputs, package postinstalls, issue text. Goals: exfiltrate secrets, execute arbitrary code with user privileges, persist (poisoned skills/memory/macros), lateral movement (MCP credentials).

**Attack trees (condensed).**
1. *Exfiltration:* injected instruction → agent reads `.env`/keychain → encodes into a web request or commit. Cut: secrets never enter context (redaction at context assembly, entropy + known-pattern scan, allowlist for the few needed); network egress default-deny with per-domain grants; taint rule — a turn whose context contains `secret_adjacent` spans cannot receive `net` capability at all.
2. *Execution:* injected "run `curl|sh`" → Bash. Cut: Bash always executes inside the OS sandbox with the *turn's* capability set; a tainted-context turn gets `fs: workspace-ro+scratch, net: none, exec: allowlist`. The string analyzer survives only as UX (explains *why* something will be blocked) — enforcement is the kernel's job. macOS: `sandbox-exec` profile generated per capability set; Linux: bubblewrap (namespaces) + Landlock + seccomp; Windows: restricted-token + firewall rules (weakest tier, documented).
3. *Persistence:* injection → SkillAuthorTool writes a skill / user-model learns a hostile "preference" / macro compiled from attacker-shaped episodes. Cut: **provenance ceilings** — every learned artifact records the taint of its sources; artifacts with `web|mcp`-tainted provenance can never auto-activate, they queue for human review with a diff. Skills/MCP installs: hash-pinned manifests, lockfile, signature when available, and a rendered capability manifest ("this skill wants: net:github.com, fs:./docs") the user approves like a mobile app.
4. *MCP lateral movement:* malicious/compromised MCP server output steers the agent. Cut: each MCP server runs as an OS-sandboxed child with scrubbed env (only its own declared secrets), response schema validation, size/rate limits; **all MCP output is born tainted**.

**Privilege model.** Principals: user > session > turn > tool-call > dream-episode. Capabilities only narrow down the chain. Dream episodes get the floor: ephemeral worktree (with `--no-hardlinks` object copy for the touched paths — filesystem *and* object isolation), `net: none`, env scrubbed to a 6-variable allowlist, CPU/memory/time rlimits, and results re-enter the trusted store only through the objective grader (a patch is data until re-verified inside the trusted zone).

**Taint propagation:** context spans carry labels `{user, repo, web, mcp, derived}`; the loop computes the turn ceiling as the max taint of spans *referenced by the model's tool call arguments* (cheap heuristic: argument substring provenance), with the conservative fallback of whole-context max when attribution is ambiguous. Over-blocking is mitigated by a one-keystroke elevation prompt that shows the tainted span. This is the design competitors will find hardest to retrofit — their loops don't track provenance at all.

---

## 7. Evaluation Framework

**Infrastructure:** episode bundles (§5) make every past run replayable: the eval harness re-executes tool calls against a repo snapshot (git worktree at the recorded commit) and serves LLM responses from the recorded cache. Two eval modes: **replay** (deterministic, free, tests harness/policy changes) and **live** (spends tokens, reserved for release gates, budget-capped).

**Task corpus:** 3 tiers — (T1) 50 curated cross-repo tasks (bug-fix, feature, refactor) with objective checks; (T2) per-repo generated tasks from the dream mutation engine (ground truth known); (T3) harvested real episodes with verified outcomes. Corpus versioned in the ledger.

**Per-feature protocol** (every mind feature, no exceptions):

| Feature | Hypothesis | Metric | Test | Gate |
|---|---|---|---|---|
| Self-model routing | Hints reduce failed mutation attempts | failed-edit rate/episode; tokens-to-green | paired permutation test on matched episodes; off-policy DR estimate first | DR estimate CI excludes 0 before live A/B; live paired test p<0.05, effect ≥ 10% |
| Calibration escalation | Escalation cuts regression escapes | escaped-regression rate; latency cost | one-sided binomial, cost-bounded | escapes ↓ with latency ↑ ≤ 15% |
| User model warnings | Warnings predict rejections | AUROC of P(reject) | bootstrap CI | AUROC > 0.7 sustained 4 wks |
| Macros | Deterministic path ≥ modeled path | postcondition success; latency; tokens | per-macro binomial | non-inferior success, ≥ 30% latency ↓ |
| Drives prompts | Deviation surfacing → faster restoration | time-to-restore; nag-dismissal rate | survival analysis (log-rank) | restore ↓, dismissals < 20% |
| Dream mode | Practice improves frontier success | curriculum Elo slope; transfer to T1 | change-point on learning curve | positive slope, T1 transfer ≥ 5% |

Ablations run in **replay mode weekly** (free); a feature whose effect decays below gate for 3 consecutive weeks is auto-demoted to shadow (still logging counterfactuals, no longer acting) — concept drift handled at the *feature* level, and "no feature ships without evidence" is enforced by the flag system, not by discipline.

---

## 8. Learning Architecture (the required properties, located)

- **Append-only event sourcing** — §3.1. **Causal attribution** — TDM scoping (§3.4) + `parent` event chains + episode segmentation. **Confidence estimation** — posteriors everywhere (§4.1–4.6). **Online learning** — bandit updates per episode; views fold incrementally. **Uncertainty tracking** — every surfaced number carries its CI; the TUI renders it. **Repo/user/model adaptation** — hierarchy dimensions; assertions scoped; cells conditioned. **Rollback** — refold from any `seq`; policies are versioned arms, deactivation is one event. **Contradiction detection** — assertion embedding opposition (§3.5). **Drift** — BOCPD per cell, CUSUM per drive, weekly replay ablations per feature. **Reproducible evaluation** — bundles + replay mode (§7). **No heuristic memories** — project-memory "lessons" are replaced by *episodic exemplars with verified outcomes* (§9.3); free-text memory remains only as user-authored notes, never auto-learned.

---

## Dream Mode v2 (the flagship, rebuilt)

**Pipeline per cycle (journaled state machine, resumable at every step):**

1. **Budget check** — token/CPU/disk ledgers; cycle refuses to start without headroom.
2. **Task generation**, four generators feeding one pool:
   - *Restoration:* drive deviations (unchanged, now CUSUM-backed).
   - *Mutation self-play:* tree-sitter mutation operators (negate condition, off-by-one, boundary swap, drop null-guard, swap arguments, wrong constant) applied to functions **with TDM-verified covering tests**; a mutant that survives its tests is discarded (undetectable = ungradeable); a killed mutant becomes task "tests fail; fix the defect" with **known ground truth** and a canonical patch for later diff-quality scoring. Seeded PRNG → reproducible.
   - *Regeneration:* delete a well-tested function body, keep signature + tests ("implement from spec").
   - *History replay:* past real episodes re-attempted from their bundles' starting snapshots.
3. **Curriculum:** each task gets a difficulty vector (mutation class, blast radius from the graph, test distance, file familiarity from the ledger); agent skill and task difficulty jointly estimated by a 2-parameter IRT/Elo model updated per episode; sampler targets `P(success) ≈ 0.65` (maximally informative frontier), with 20% easy (regression canary) and 10% hard (exploration).
4. **Execution:** sandboxed episode (§6 floor capabilities), heartbeat-monitored, bundle-recorded.
5. **Grading (objective only):** tests green + **no unrelated check regressions** (TDM) + diff quality vs. canonical patch (AST-edit distance, size ratio) + no post-condition taint violations.
6. **Retention:** passing restoration patches → review branch (unchanged); mutation fixes → *not merged* (the un-mutated original is truth) — their value is the experience.
7. **Distillation:** every episode yields (a) posterior updates to self-model cells, (b) an **exemplar**: embedded (task context → successful trajectory sketch → verified outcome) stored for retrieval-augmented prompting on similar future tasks, (c) for failures, a structured failure event (which step diverged from the canonical patch — computable because ground truth exists).
8. **Convergence/stopping:** cycle ends at budget, or when the Elo learning-curve slope's 95% CI includes zero across the last k cycles (plateau) — then the sampler shifts generators (more regeneration, fewer mutations) or halts and reports "practice saturated; corpus needs new task classes."

Everything is an event; `bimax dream replay <episode>` reproduces any run bit-for-bit from its bundle.

---

## 9. Next-Generation Features (no public agent ships these)

1. **Provenance-scoped capabilities (taint-gated authority)** — §6. *Why it matters:* prompt injection is the industry's open wound; every competitor's mitigation is prompt-level. *Why hard to copy:* requires provenance plumbing through the entire context assembly path — a rewrite for loop architectures that treat context as a flat string.
2. **Counterfactual shadow policies** — every learned behavior logs propensities and shadow decisions, so policy improvements are proven on historical traffic before spending a token. *Copy difficulty:* needs the ledger; bolting IPS onto stateless agents yields nothing to evaluate.
3. **Experience retrieval (episodic memory with verified outcomes)** — few-shot exemplars from *this repo's own verified successes*, retrieved by local embeddings, injected instead of generic instructions. The agent literally gets better at *your* codebase with every verified episode — and can show the receipts. *Moat:* the exemplar corpus is the user's, non-transferable.
4. **Mutation-grounded self-play with IRT curriculum** — dream v2. *Moat:* composition of six subsystems (graph, TDM, sandbox, journal, bundles, ledger); copying the idea without the substrate yields the v1 toy.
5. **Agent black-box recorder** — deterministic replay bundles + `bimax replay` time-travel debugging of any agent decision ("why did it edit that file?" answered from the recorded posterior + retrieved exemplars + active arms). *Why it matters:* trust and debuggability are the #1 enterprise objection to autonomous agents; nobody offers flight recorders.
6. **Verification-coverage drive** — "what fraction of your edits does *anything* verify?" surfaced from unresolved-claim statistics; turns the attribution system's residue into a product insight no other tool can compute.
7. **Semantic merge queue** — AST-level file claims enabling safe concurrent agents (§3.10). Table stakes in 2 years; early now.

---

## 10. Migration Plan & Prioritized Roadmap

**Phase 0 (wks 1–2):** typed tool outcomes; schema codegen for protocol. Zero behavior change, unblocks everything.
**Phase 1 (wks 3–8):** the Ledger + daemon + view framework; singletons become shims; legacy import. *Gate:* two concurrent sessions, zero loss, refold determinism test.
**Phase 2 (wks 7–12, overlaps):** sandbox broker (macOS first, Linux next) + taint labels + dream floor caps. *Gate:* red-team suite (30 injection scenarios) — zero exfiltration/execution escapes.
**Phase 3 (wks 10–16):** TDM + scoped attribution + isotonic calibration; hierarchical self-model; drives CUSUM. *Gate:* calibration on synthetic ground truth (injected known-outcome claims) within 5% ECE.
**Phase 4 (wks 14–20):** episode bundles + replay eval harness + flags/ablation system. *Gate:* one feature demoted or confirmed by real evidence — proving the gate works.
**Phase 5 (wks 18–26):** dream v2 (mutation gen → curriculum → distillation → exemplar retrieval); macro compiler. *Gate:* positive Elo slope + T1 transfer.
**Phase 6 (wks 24–30):** incremental graph store; durable pipelines; semantic merge queue.
Throughout: every phase ships behind flags with its ablation; the README's adjectives are replaced by its confidence intervals.

---

## 11. Ruthless Self-Critique (three cycles, then the residue)

**Cycle 1 — the panel attacks:**
- *Anthropic:* "Taint attribution via argument-substring provenance is spoofable — the model can launder tainted content by paraphrasing before tool use." **Accepted.** Revision: taint ceiling defaults to *whole-context max* whenever any untrusted span exists; substring attribution only ever *narrows* within a turn the user has elevated. Laundering now requires the human to have already approved elevation.
- *Cursor:* "Local 30MB embeddings will be mediocre; your k-NN taste model inherits that." **Partially accepted.** Mitigation: embeddings are only ever *evidence retrieval* (with the retrieved items shown), never silent classifiers; the eval gate (AUROC > 0.7) demotes it honestly if the model is too weak, and the embedding model is swappable (it's a view input, not baked into events).
- *DeepMind:* "IRT with one agent and noisy binary outcomes converges slowly; your curriculum will thrash early." **Accepted.** Revision: cold-start curriculum uses the difficulty *prior* from static features only (mutation class, blast radius); IRT takes over after 100 episodes; thrash bounded by the 20% easy floor.
- *Distributed-systems researcher:* "Daemon-per-repo is lifecycle pain — orphans, upgrades, socket permissions." **Accepted.** Revision: daemon is optional; single-session mode writes the ledger directly with `BEGIN IMMEDIATE` transactions (SQLite handles one writer fine); the daemon spawns lazily only when a *second* session arrives, handing off via lease. Removes the always-on process objection.

**Cycle 2:**
- *Compiler engineer:* "Tree-sitter mutation on 20 languages: operator semantics differ (Python truthiness vs Go zero-values); naive negation creates equivalent mutants that poison difficulty estimates." **Accepted.** Revision: per-language operator packs, launched with TS/Go only; equivalent-mutant filtering via the existing test kill requirement plus a compile-and-hash check (mutant binary-identical → discard).
- *GitHub:* "Enterprise won't run a tool whose learned state is unauditable per-user." Already answered by the ledger (export, review, redact by refold) — promoted to a documented compliance story rather than an accident.
- *Security researcher:* "Windows tier is a hole; say so loudly." Accepted: Windows ships with autonomy features (dream, auto mode) **disabled by default** until the restricted-token sandbox passes the same red-team gate.
- *OpenAI:* "Your eval corpus (50 curated tasks) is underpowered for 10% effects." Accepted: T2 generated tasks are the power source (hundreds per repo, ground truth known); T1 is the external-validity check only; acceptance criteria re-stated against T2 sample sizes (n ≈ 400 → detects 8pp at 0.8 power).

**Cycle 3:** remaining findings were marginal (bundle storage growth → content-dedupe + 90-day cold compression; HLC clock skew → bounded by local-only merges; fold determinism vs. floating point → integer/rational arithmetic in views). Diminishing returns reached.

## Remaining Risks (unavoidable trade-offs, stated plainly)

1. **Complexity vs. team size** — this is a 5–8 engineer, ~7-month system. Built solo, sequenced exactly as the roadmap orders it, each phase is independently shippable; but the risk is real and no architecture removes it.
2. **The base model remains the ceiling** — engineering narrows the gap on *reliability, safety, learning, and trust*; it cannot make a weak model reason better. BiMax v2's claim is bounded and honest: *same model in, more verified outcomes out.*
3. **Taint UX friction** — some over-blocking is irreducible; the one-keystroke elevation is a mitigation, not a cure.
4. **Local embedding quality** — capped, monitored, swappable; still a cap.

## 12. Final Technical Review

Against the previous review's criticisms: persistence races → eliminated by construction (ledger); attribution → causally scoped with stated weights; magic numbers → posteriors with declared decision thresholds; regex classification → typed contracts; marketing names → mechanisms that now do what the names claim (macros execute; calibration calibrates; dreams practice with ground truth); security → kernel-enforced capabilities with provenance ceilings; measurement → nothing acts without counterfactual evidence, and features demote themselves. The panel's structural criticisms are resolved; what remains are the three honest trade-offs above — model ceiling, complexity budget, and friction — which no competitor escapes either. That is the point: **when everyone has the same models, the winner is whoever turns identical intelligence into verified outcomes, provable learning, and enforceable trust. That is now BiMax's architecture, not its aspiration.**