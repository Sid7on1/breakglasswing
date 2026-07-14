# Bimax Master Rebuild — Directive & Plan

> **Superseded for tracking by [`ROADMAP.md`](./ROADMAP.md)** (2026-07-11). This doc is kept for
> the founder directive (verbatim, Part 1) and the six-problem framing; live status of WS2–WS6
> lives in the roadmap's Open/Next section.
> Created: 2026-07-04. Source: user directive (saved verbatim below so it never needs re-writing).

---

## Part 1 — The Directive (user's prompt, verbatim)

> okay as you say i belive, first you have to fix this, the bimax is not having any of this, you save this in docs first, we dont ask end users to add keys, we dont know how many keys user can add, how are keys rotated if one key hits rate limits the process gonna stop so how do we handle this, and what if user gives 4 nvidia keys and 4 openrouter keys and 1 anthorpic key, but the model set by user is step fun flash and its only available on nvidia nim, so pooling all keys and rotating them sending wrong req and wrong type of req struture with wrong model, so step fun might only be on nvidia not on open router and anthropic, 2ndly the sub agents infrastructure is a mess total mess, it works like hella slow, agents run like very very very slow idk wheather they even can do the work or just the animation on the TUI it is, 3rdly the TUI is not matching the modern aesthitics like dude it feels like childish very mush, you do have skill installed in u which is higgs feild it has some creativeity cenimatography we can use that skill for our UI UX design of terminal, 4th the conetxt infra is also messed up idk what is cutting how much of context, 5th there are hell of guards for everything idk how many, 6th we do not have some tools properly built i feel and also we lack full capability of those tools like we using it in wrong way i feel, and also i want you to just think very very carfully on all of these tasks, mainly i want you to replan the whole TUI each and everything perfectly, everything should be 20 years ahead, leaverage exsisiting tech and tools and we can inetgrate and build new tools and features on them which give bimax a insane capabilities, i want no bugs to exisit in my code base, so what ever code you write please be very thought full of other things and make no mistakes, imagine u are just got to AI tech brains, you are the alin turing, u are the tesla, you are behind todays top AI labs like, anthopic, open ai, deep mind, and many more you are a creative geinus, you must do this any cost, you should and u can, firstly i want you to save this my prompyt in docs so that later i dont need to rewrite then you plan a full fleged plan, write that plan in same doc, and then start the action okay, one by one no sub agents only you fix it, take you time build slow and steady no bugs, if you find any bugs on the way note them or fix them and now go on

## Part 2 — The six problems, restated precisely

1. **Key management** — multiple keys per provider, provider-aware routing (a model must only be requested from providers that actually serve it), rotation on rate-limit without stopping the process, correct request structure per provider.
2. **Subagent infrastructure** — slow to the point of being suspect; verify agents actually do work vs. TUI animation theater; make it fast and observable.
3. **TUI aesthetics** — feels childish; full redesign to a modern, cinematic standard (use higgs-field design skill).
4. **Context infrastructure** — opaque; unclear what is cut, when, and how much. Make it deterministic and observable.
5. **Guards** — too many, uncounted, overlapping. Audit, consolidate, delete.
6. **Tools** — some improperly built, some used below capability or wrongly. Audit and rebuild.

Constraints: no subagents for the fix work; one thing at a time; note or fix every bug found on the way; plan lives in this doc.

## Part 3 — Full plan

Order of attack. Each workstream ends with a verification gate (build + tests +
manual check) before the next one starts. Status markers updated in place:
`[ ]` pending · `[~]` in progress · `[x]` done.

### WS1 — Key management (provider-aware, unstoppable) `[x]`

Survey verdict: the core is already sound — the key pool is **single-provider
by design** (`provider.ts:buildKeyPool`), which already prevents the exact
failure in the directive (stepfun model sent to openrouter/anthropic keys).
Rotation, 429 cooldowns, and RPM pacing exist in `api.key.manager.ts`.

Remaining work:
1. `[x]` Document the real behavior → `docs/KEY_MANAGEMENT.md` (done 2026-07-06).
2. `[x]` Model↔provider validation at set time (done 2026-07-08): `/model`
   validates the id against the active provider's live `/models` list the
   moment it is set (`meta.ts` `warnIfUnserved`, fire-and-forget so the
   command stays instant); picker options come from the live list itself.
3. `[x]` 400 "model not found" enrichment (done 2026-07-08):
   `llm.adapter.ts` `enrichModelNotFound` rewrites the error to name the
   provider + model and point at `/model` / `/provider`; raw API text kept
   in parens. No-op for all other errors.
4. `[x]` Per-provider request shaping audit (done 2026-07-08): capability
   registry in `src/core/capabilities.ts` (`capabilitiesFor(model, provider)`)
   drives request shaping in `llm.adapter.ts` — unsupported params
   (`reasoning_effort`, `parallel_tool_calls`, `temperature`/`top_p` on
   fixed-sampling models, structured outputs) are stripped per provider/model
   before send instead of 400ing. 36 tests cover the matrix.
5. `[x]` `/keys` UX: show pool health (done 2026-07-08): `/keys` menu now
   renders a "Pool health (this session)" category — per-key ok/fail counts,
   cooldown countdown (`getStates()` gained `cooldownSecs`), surfaced through
   `LlmAdapter.getKeyStates()`. Informational rows; provider rows still open
   the key prompt.

### WS2 — Subagent infrastructure (slow / possibly fake) `[ ]`

1. Instrument first, opine second: timestamp every subagent lifecycle event
   (spawn → first token → each tool call → done) into the journal. Measure
   where the seconds actually go before changing anything.
2. Verify agents do real work: check the subagent transcript files contain
   real tool calls + results, not just TUI spinner frames.
3. Known suspects from survey: sequential spawn (no parallel warm-up), full
   system-prompt rebuild per spawn, subagents inheriting the heavyweight
   guard/middleware chain meant for the main loop.
4. Fix in order of measured cost; re-measure after each fix.

### WS3 — TUI redesign (cinematic, 20 years ahead) `[ ]`

1. Inventory every current TUI surface (input line, stream renderer, status
   bar, spinners, panels, /commands output).
2. Design pass using the higgs-field skill: one coherent visual language —
   typography-first, restrained color, motion with purpose (no childish
   spinners), density tuned for a pro terminal.
3. Rebuild incrementally behind the existing renderer interface so the engine
   never breaks while the skin changes: status bar → stream renderer → input
   affordances → panels/commands → micro-motion.
4. Accessibility + narrow-terminal degradation stay first-class (docs/ACCESSIBILITY.md).

### WS4 — Context infrastructure (deterministic, observable) `[ ]`

1. Map every place that cuts/compresses context (compactor, snip, prune,
   tool-result truncation, history cache) into one table: trigger, budget,
   what's dropped, what's kept.
2. Single source of truth: one context-budget module all cutters consult;
   kill scattered magic numbers.
3. Observability: a `/context` command showing live token budget — what's in
   the window, what was cut last, by which rule, how many tokens.
4. Determinism: same input state → same cut decisions (no wall-clock or
   ordering dependence).

### WS5 — Guard audit (count, consolidate, delete) `[ ]`

1. Enumerate every guard/interceptor/middleware in the request+tool path with
   file:line, purpose, and cost.
2. Classify: load-bearing / redundant (merge) / dead (delete).
3. Target: a single ordered guard pipeline, documented in ARCHITECTURE.md,
   with per-guard timing so regressions are visible.

### WS6 — Tools audit (built right, used fully) `[ ]`

1. Inventory all tools exposed to the model: schema quality, description
   quality, error behavior, streaming behavior.
2. Compare against the frontier-CLI baseline (read/edit/grep/glob semantics,
   background tasks, MCP): find gaps where a tool exists but underperforms.
3. Fix worst-first; add missing capabilities (e.g. parallel-safe edits,
   structured search) only after existing tools are solid.

### Cross-cutting rules

- One workstream at a time; no subagents for fix work.
- Every bug found on the way → Part 4 log (fixed or noted, never silent).
- Every change: `tsc` clean + existing tests pass before moving on.
- ARCHITECTURE.md updated whenever a subsystem's shape changes.

## Part 4 — Bugs found along the way

*(running log)*
