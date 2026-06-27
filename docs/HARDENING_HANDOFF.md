# Hardening Handoff — bimax reliability & feature-completeness

> **Purpose.** This is a cold-start handoff. A future session with no prior context can read
> this file top-to-bottom and continue the work. It records what was stress-tested, what was
> fixed, the *real* state of every subsystem (from reading the code), the one blocker that gates
> everything, and a prioritized, file-level plan to finish.
>
> Written 2026-06-14 on branch `hardening/agent-loop-and-heavy-features`.

---

## 0. TL;DR

- bimax is an **autonomous coding-agent CLI** (`bin/bimax.js` → `dist/index.js`). It is **~90%
  built and wired** — almost nothing is stubbed — but only **~20% is verified working end-to-end**.
- **"Everything is broken" is false.** The read / search / diagnose / run-commands path works.
  All 4 heavy features (council, swarm, speculate, evolve) are real implementations wired to
  slash commands. 208 unit tests pass.
- **The one blocker that gates everything: edit-quality with the default model.** The agent loop
  now *completes and recovers* reliably (fixed this session), but the model (`meta/llama-3.1-70b-
  instruct` on NVIDIA NIM) produces **corrupt edits** — it overwrites whole files and collapses
  all newlines, or emits malformed multi-line JSON. Every agentic feature (swarm/speculate/evolve
  spawn subagents on the *same* loop) inherits this ceiling, so they amplify the flaw.
- **Next lever is NOT testing the heavy features** (they'll fail the same way). It's **making a
  single edit reliably correct.** Then the rest unlocks.

---

## 1. Environment / how to run (READ FIRST — see also memory `bimax-setup`)

- Project root: `~/Desktop/breakglasswing`. Global `bimax` is `npm link`-ed here
  (`/opt/homebrew/bin/bimax` → this repo). **NOT** `breakglasswingOG` (stale clone, never global).
- **After ANY source change you MUST `npm run build`** (tsc → `dist/`) or the CLI runs stale code.
- LLM: NVIDIA NIM (`https://integrate.api.nvidia.com/v1`), default model
  `meta/llama-3.1-70b-instruct` (set in `.breakglass/config.json`). Keys auto-load from
  `~/.breakglass/.env` (`NVIDIA_API_KEY`, comma-sep = round-robin). Fast model; supports tool calls.
- **Latency reality:** ~3–4 min per print-mode task (model is slow + autoIndex + offline vector
  search run on every invocation). Budget for it when testing. Cost ~$0.10–0.18/task; per-repo
  $5 governor cap.
- **Headless test recipe** (what was used this session):
  ```bash
  cd ~/Desktop/ArchMind   # the sample repo (see §2)
  bimax -p -y --print-with-tools "<task>" > /tmp/out.txt 2>/tmp/err.txt
  ```
  `-p` print mode, `-y` skip permissions, `--print-with-tools` shows tool activity on stderr.
  Useful env knobs: `BGW_STREAM_TIMEOUT_MS` (default 60000; raise if streams stall),
  `BGW_REASONING_EFFORT=low` (halves latency), `BGW_PARALLEL_TOOL_CALLS=true` (re-enable parallel
  tool calls — leave OFF for NVIDIA).
- **Sample codebase for testing: `~/Desktop/ArchMind`** — a real TS conflict-detection tool
  (tree-sitter based). Has a git repo + `npm test` (51 assertions). Good edit/diagnose target.

---

## 2. ArchMind sample repo — current state

- Was 100% broken: native `tree-sitter` binding built for an old Node ABI → `require('tree-sitter')`
  segfaults (exit 139) under Node v22 → all 6 test fixtures crash.
- **FIXED** (deterministically, not via bimax): `cd ~/Desktop/ArchMind && npm rebuild tree-sitter
  tree-sitter-javascript tree-sitter-typescript`. Now `npm test` → **51/51 assertions pass**.
- ⚠️ If a future bimax edit corrupts a file there, restore from `~/Desktop/ArchMind/.breakglass/
  backups/<timestamp>_<file>` (bimax auto-backs-up before edits — this works and saved jwt_rule.ts
  once this session).

---

## 3. What was FIXED this session (committed to working tree, NOT yet git-committed)

All on branch `hardening/agent-loop-and-heavy-features`. Build clean, 208 jest tests pass.

1. **Parallel-tool-call 400.** NVIDIA rejects >1 tool call per turn (`400 This model only supports
   single tool-calls at once!`) → task aborted. Fix: `src/core/llm.adapter.ts` sets
   `requestOptions.parallel_tool_calls = false` when tools present (override `BGW_PARALLEL_TOOL_CALLS=true`).
2. **Unvalidated bash timeout.** Model emits `timeout` as string/float/out-of-range → Node `exec`
   throws `ERR_OUT_OF_RANGE` → task derails. Fix: `src/tools/implementations/bash.tool.ts` coerces +
   clamps to a finite int in `[0, 600000]`ms.
3. **Transient errors hard-aborted the task → bounded retry.** The loop treated every non-context
   error as fatal. Fix:
   - `src/core/llm.provider.ts`: error event now carries `kind?: 'context' | 'transient'`.
   - `src/core/llm.adapter.ts`: new pure `classifyStreamError(e)` buckets errors
     (context-overflow → compact; stalled stream / 5xx / malformed-tool-JSON / multi-tool-call /
     out-of-range → transient; else fatal).
   - `src/core/agent.loop.ts`: on `kind:'transient'` it re-asks up to `MAX_TRANSIENT_RETRIES=2`
     (fresh `chat()` rotates key + re-samples), then surfaces the error. Flag renamed
     `retryAfterCompaction` → `discardTurn`.
   - Tests: `src/__tests__/classify.stream.error.test.ts` (new), transient cases in
     `agent.loop.recovery.test.ts`, bash-timeout coercion in `tools.test.ts`.
   - **Verified:** the edit task that previously failed 3 different ways now completes end-to-end.

---

4. **Gratuitous AskUserTool → degenerate-ask guard (2026-06-14).** The model fired `AskUserTool`
   as a conversational reflex for trivial input ("hi", "who are you?") — pausing on a fake
   choice (`Ask(I)` with no real options) before answering anyway. Fix: `src/tools/ask-guard.ts`
   `detectDegenerateAsk()` refuses calls with <2 distinct options or an empty/garbage question;
   wired into `ask_user.tool.ts` execute() returning a refusal that steers the model to answer
   directly. Tests in `tools.test.ts` (`Degenerate AskUserTool guard`). Suite 219/219.

5. **Dead search/fetch/todo tools — persona wiring gap (2026-06-14).** `container.ts` registered
   `GrepTool`, `GlobTool`, `TodoWriteTool`, `WebFetchTool`, `CreateDirectoryTool`, but **no
   persona's `allowedTools` listed them**, so `base.persona` filtered them out and the model never
   saw them — it was forced to shell out via Bash for search/fetch and had no todo/mkdir tool.
   (Hermes was literally described as a "search agent" with no search tool.) Fix:
   `src/cli/personas/implementations.ts` adds the tools to each persona by role; `worker.entry.ts`
   now also registers `TodoWriteTool` for subagent parity; `ToolCallLine.tsx` gets labels +
   arg-preview keys (pattern/glob/url) for the newly-visible tools. Regression test:
   `src/__tests__/persona.wiring.test.ts`. Suite 223/223.

6. **Blast-radius riskScore always 0 (2026-06-14).** `impact.engine.ts` read `node.metadata?.riskScore`
   when computing `BlastRadiusReport.highestRiskScore`, but the semantic augmenter stores `riskScore`
   as a top-level `GraphNode` field — so the metric was always 0, the `BLAST_RADIUS` tool's "Highest
   downstream criticality score" line was meaningless, and the severity heuristic (`>= 70`) never
   fired on risk. Fix: read `node.riskScore` (metadata fallback kept). Regression test:
   `src/__tests__/impact.engine.test.ts`. Suite 225/225.

## 4. Real state of every subsystem (from reading src/, not guessing)

Only 2 trivial stubs exist repo-wide (`src/storage/state.sync.ts` simulated upload,
`src/cli/commands/file.ts` simulated redirect). Everything below is genuine code.

| Subsystem | LOC | Real? | Unit test? | End-to-end verified? |
|---|---|---|---|---|
| Agent loop / tools (read/bash/edit/search/git/todo) | — | ✅ | ✅ | ✅ read/bash/diagnose; ⚠️ edit corrupts (see §5) |
| `evolution/council.orchestrator` | 163 | ✅ git-worktree + judges external CLIs by tests | ❌ | ❌ |
| `evolution/swarm.orchestrator` | 223 | ✅ Kahn waves → subagents → merge | ❌ (pieces tested) | ❌ |
| `evolution/speculative.solver` | 142 | ✅ competing branches, run tests | ✅ | ❌ |
| `evolution/genome.evolver` | 143 | ✅ genome repo + ArchitectureGuardian | ❌ | ❌ |
| `evolution/worktree.manager` | 121 | ✅ | ✅ | — |
| `core/subagent.manager` | — | ✅ watchdog (`BGW_WORKER_TIMEOUT_MS`) | ✅ | partial |
| `task/decomposer` | — | ✅ | ✅ (fence-parse bug fixed, see memory) | — |
| `graph/*` (tree-sitter, static analyzer, impact, context planner) | 1623 | ✅ | ✅ analyzers, readsymbol; ❌ impact engine | ❌ |
| `mcp/*`, `lsp/*` | 192/172 | ✅ (thin clients) | ✅ client tests | ❌ live server |
| `sandbox/*` (sandbox-exec) | 666 | ✅ | ✅ | partial |
| `governor/*` (budget/veto/plan-mode) | 462 | ✅ | ✅ | ✅ (logs seen) |
| `cli/screens/*` (interactive TUI, ink/react) | 1146 | ✅ | partial (key/menu tests) | ❌ never launched this session |

**Wiring confirmed:** all 4 orchestrators reachable via `src/cli/commands/{council,swarm,speculate,
evolve}.ts`.

---

## 5. THE BLOCKER — edit quality — ✅ FIXED (2026-06-14)

**Status: resolved.** A corruption guard now refuses corrupt writes before they touch disk, and
the model self-corrects to a surgical edit. Verified end-to-end: the ArchMind JSDoc task that
corrupted the file twice now lands correctly (file stays 75→76 lines, tsc clean, tests 51/51).
bimax's own words from the passing run: *"WriteFileTool refused… because the new content had only
1 line, which looked like a corrupt write. Instead, EditFileTool was used to surgically replace…
keeping the real newline characters."*

What shipped:
- `src/tools/write-guard.ts` — new pure `detectCorruptWrite(prior, next, path)`. Fires when a
  structured file (≥6 lines) is replaced by a 1–2 line blob (catches **flattening** *and*
  **truncation**, regardless of byte length), or when content carries ≥2 literal `\n` escapes with
  no real newlines. Conservative: never blocks an ordinary edit; skips `*.min.*`.
- `src/tools/implementations/file.tool.ts` (WriteFileTool) and `edit.tool.ts` (EditFileTool) call
  it before writing and return an actionable refusal pointing the model to a surgical edit.
- WriteFileTool description updated to mandate `EditFileTool` for existing files + real newlines.
- Tests: `Flattened-file corruption guard` block in `src/__tests__/tools.test.ts` (flatten,
  truncate-with-literal-`\n`, edit-path, plus two no-false-positive cases). Full suite 213 green.

> ⚠️ Note on the journey (don't repeat the mistake): the first guard version gated on
> `content.length > 200`, which let the real failure (a 131-byte *truncation*) through. The
> length floor was wrong — a multi-line file collapsing to ≤2 lines is corruption at **any**
> size. That's why the rule is now line-count based, not length based.

### (historical) original diagnosis

**Symptom.** Asked to add a JSDoc block to `src/engine/rules/jwt_rule.ts`, the model overwrote the
whole file via `WriteFileTool` and **collapsed every newline → the 75-line file became 1 line →
broke compile** (`TS1005`). Earlier attempts instead threw `400 Unterminated string` (malformed
multi-line JSON in tool args). The surgical `EditFileTool` (`src/tools/implementations/edit.tool.ts`)
is *faithful* — it does exact oldString→newString and does not mangle newlines. The corruption comes
from the **model** choosing whole-file overwrite + flattening, ignoring the tool's own "prefer
surgical edit" guidance.

**Why it matters most.** swarm/speculate/evolve all spawn subagents on the same loop+adapter, so
they inherit this. Multi-agent features amplify corruption rather than fixing it.

**Recommended fix (no test exists yet — write one):**
1. **Reject/rollback corrupt writes.** In `WriteFileTool` (`src/tools/implementations/file.tool.ts`)
   and/or the edit path: after a write to a known code extension, if the new content has drastically
   fewer newlines than the old (e.g. old had >5 lines and new collapses to ≤2), treat it as
   suspected corruption — refuse and return an error telling the model to use surgical `EditFileTool`
   with explicit `\n`. The backup already exists in `.breakglass/backups/`; wire an auto-restore.
2. **Push the model to surgical edits.** Strengthen the system/persona prompt
   (`src/cli/personas/implementations.*`) to forbid full-file `WriteFileTool` on existing files and
   mandate `EditFileTool`. Lower-effort, partial.
3. **Validate-before-commit in worktrees.** council/swarm/speculate already run `npm test`; ensure a
   subagent's corrupt edit fails its branch's build so it can't win/merge. Check the judge logic in
   each orchestrator treats build failure as disqualifying (council does — `runTests`).
4. **Real lever:** allow a **stronger write model** per-task (config already supports `-m` and
   `customRoutingRules` in `.breakglass/config.json`). Route edit-heavy work to a better model, keep
   llama-70b for read/diagnose.

---

## 6. Other known gaps (lower priority than §5)

- **Retrieval grounding.** Asked about `src/engine/rules/*.ts`, bimax answered about
  `.agents/rules/*.md` (lexical "rule" match) — the memory VectorStore (`src/memory/vector.store.ts`)
  was empty, so this was the **search tool surfacing similar files + weak instruction-following**.
  Mitigation: make the search tool / context builder honor explicit paths in the prompt; consider
  real embeddings (`src/memory/embeddings.ts` is the offline generator — likely weak).
- **Cold-start latency ~4 min.** autoIndex (`src/graph/indexer.ts`) + offline vector search run every
  print invocation. Add an index-freshness cache (skip rebuild if graph cache newer than source
  mtimes). Perf, not correctness.
- **printWithTools markers** (`⏺`/`⎿`) didn't appear on stderr in print mode this session — check the
  cliEvents wiring in `src/cli/print.ts` vs the persona path.
- **No e2e tests** for council, swarm, genome-evolve, impact engine.

---

## 7. Prioritized plan for the next session

1. ~~**Fix §5 edit-quality.**~~ ✅ DONE 2026-06-14 — corruption guard shipped + verified e2e (see §5).
   The single biggest blocker is cleared: agent edits no longer corrupt files; the model
   self-corrects to surgical edits.
2. **Prove one heavy feature end-to-end on a throwaway repo.** Easiest is **council** (no internal
   LLM — uses external CLIs; deterministic). Recipe in memory `bimax-setup`: instantiate the
   orchestrator from `dist/evolution/*` against a `git init` /tmp repo, `LlmAdapter(new
   ApiKeyManager(buildKeyPool()))` with no budget veto, `parentMode 'bypass'`. Then **speculate**,
   then **swarm** (these DO use the model → expect §5 issues until fixed).
3. **Add e2e smoke tests** for the 4 orchestrators (mock subagent that writes a known file; assert
   worktree create → branch → judge → merge/surface).
4. **Retrieval grounding** + **latency cache** (§6) — quality/perf polish.
5. **Launch the interactive TUI** at least once (`bimax` with no args) and smoke the high-traffic
   slash commands (`/swarm /council /graph /index /diff /model /context`).

---

## 8. Pointers

- Persistent findings live in auto-memory: `bimax-setup`, `agent-loop-tool-call-bugs`,
  `swarm-decomposer-bug`, `treesitter-abi-pin` (see the project's `memory/MEMORY.md`).
- Other docs: `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/ROADMAP.md`.
- Verify any change: `npm run build && npx jest` (expect all green), then a headless ArchMind run (§1).
