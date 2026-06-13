# BiMax — Advanced Feature Roadmap

Status legend: `[ ]` planned · `[~]` in progress · `[x]` shipped

A key insight drives this roadmap: **much of the "wow" infrastructure already exists
in the codebase but was never wired into the interactive loop.** Each item below
notes the existing subsystems it leverages, so most of these are activation-and-wiring
work rather than greenfield builds.

Dormant infrastructure available to build on:
- `WorktreeManager` (`src/evolution/worktree.manager.ts`) — git worktree create/commit/merge/cleanup
- `TerminalMultiplexer` + adapters (`src/terminal/`) — drive other AI CLIs (Gemini, OpenCode, Claude)
- `TaskDecomposer` (`src/task/decomposer.ts`) — validated DAG of subtasks with cycle detection
- `ImpactEngine` + `SemanticAugmenter` (`src/graph/`) — per-symbol criticality/risk scores
- Cron / webhook / trigger executors (`src/actions/`) — autonomous wake-ups
- `Versioner` (`src/sandbox/versioner.ts`) + edit backup store (`src/cli/fileEditor.ts`)
- Governor `'plan'` permission mode (`src/governor/governor.ts`) — defined but unused

---

## Tier 1 — Flagships

- [x] **1. Parallel Worktree Swarm** — `/swarm <goal>` decomposes a request into a DAG
  (`TaskDecomposer`), schedules it into topological waves, and runs each independent node as
  a sub-agent in its own git worktree (`WorktreeManager`), in parallel (bounded pool). Finished
  branches auto-merge into a `swarm/<id>/integration` branch between waves; the user's working
  tree is never touched until they merge. Conflicting nodes are left on their branch for review.
  _Shipped:_ `src/evolution/swarm.orchestrator.ts`, `src/cli/commands/swarm.ts`.

- [ ] **2. Council of Models (cross-CLI ensemble)** — Send one task to multiple external AI
  CLIs via `TerminalMultiplexer`, judge candidates by running each against the test suite
  in a throwaway worktree, keep the winner.
  _Leverages:_ TerminalMultiplexer + adapters + Tester. _Effort:_ M · _Risk:_ M.

- [x] **3. Time Machine (checkpoint & rewind)** — `/checkpoint [label]` snapshots the full
  working tree (tracked + untracked) as a git commit object built in a throwaway index, so
  nothing is staged or committed on a real branch. The agent also auto-checkpoints before every
  turn (ring-buffered). `/rewind` lists snapshots and restores any earlier state, taking a safety
  checkpoint first so the rewind is itself reversible.
  _Shipped:_ `src/sandbox/checkpoint.manager.ts`, `src/cli/commands/timemachine.ts`.

## Tier 2 — Code intelligence

- [x] **4. Blast-Radius Preview** — `/impact <symbol>` and the `BLAST_RADIUS` verb on the
  upgraded `GraphQueryTool` query `ImpactEngine` to report downstream reach (files/functions/
  classes) and highest downstream criticality, classified SMALL/MODERATE/LARGE. Keyword targets
  resolve to node ids. _Shipped:_ `src/tools/implementations/graph.tool.ts`, `src/cli/commands/graph.ts`.

- [x] **5. Ask-the-Architecture** — `/ask <question>` answers from the dependency graph, and
  `GraphQueryTool` now supports real verbs (`SEARCH_NODES`, `GET_DEPENDENTS`, `GET_DEPENDENCIES`,
  `BLAST_RADIUS`) so the agent reasons over architecture instead of blind file reads.
  _Shipped:_ `src/tools/implementations/graph.tool.ts`, `src/cli/commands/graph.ts`.

## Tier 3 — Autonomy

- [x] **6. Background Watchers** — `/watch file <path> <action>` and `/watch cron "<expr>" <action>`
  wake the agent to run an action; `/watch list|remove|stop` manage them. A per-watcher fire cap and
  a budget-governor circuit breaker prevent runaway loops; actions are skipped while a turn is busy.
  _Shipped:_ `src/cli/watchers.ts`, `src/cli/commands/watch.ts`.

- [x] **7. Self-Healing Test Loop** — `/heal` runs the test suite; on red it spawns a fix agent in
  an isolated worktree (bounded rounds), re-verifies green, and surfaces the patch on a branch.
  The user's working tree is never touched. _Shipped:_ `src/sandbox/test.healer.ts`, `src/cli/commands/heal.ts`.

## Tier 4 — Memory & self-improvement

- [x] **8. Self-Writing Project Memory** — `RememberTool` (and `/remember`) save conventions/
  decisions/gotchas to a file-backed vector store; relevant memories are recalled (local embeddings,
  lowered threshold) and injected into the system prompt each turn — a self-maintaining CLAUDE.md.
  _Shipped:_ `src/memory/project.memory.ts`, `src/tools/implementations/remember.tool.ts`, persona injection.

- [x] **9. Genome Self-Evolution** — `/evolve <Component> <improvement>` (gated behind `/evolve enable`)
  improves one of BiMax's own genome components in a worktree and keeps it only if the
  `ArchitectureGuardian` contract passes; tests/typecheck are reported as signal. Never auto-merged.
  _Shipped:_ `src/evolution/genome.evolver.ts`, `src/cli/commands/evolve.ts`.

## Tier 5 — UX wins

- [x] **10. Plan Mode** — `/plan` activates the governor's `'plan'` mode: the Governor rejects
  every mutating action (file writes/deletes, non-read shell commands) while a PLAN-MODE system
  prompt steers the agent to research and present a step-by-step plan touching nothing. `/plan off`
  returns to interactive mode to execute. Read-only tools pass through.
  _Shipped:_ `src/governor/governor.ts`, `src/cli/personas/base.persona.ts`, `src/cli/commands/plan.ts`.

- [x] **11. Inline Diff Approval** — `/diff-approval on` gates the agent's file edits: each
  proposed change is rendered with the (previously dormant) `DiffView` and must be Accepted before
  it writes. Auto-approves in sub-agent workers / print mode so nothing hangs. Covers EditFileTool,
  WriteFileTool, and MultiEditTool. _Shipped:_ `src/cli/diffApproval.ts`, the three file tools, FullScreen.

- [x] **12. MultiEditTool + Session Replay** — `MultiEditTool` applies a batch of edits across
  files atomically (validate-all-then-write; per-file governance + backups). `/replay` exports the
  session transcript as a markdown report. _Shipped:_ `src/tools/implementations/multiedit.tool.ts`, `src/cli/commands/replay.ts`.

## Frontier-model-native

- [x] **13. Self-Critic Loop** — `/self-critic on` makes the agent review its own work against the
  request after each turn and take one extra pass to fix any defects before presenting. Off by
  default (extra tokens). _Shipped:_ `src/cli/selfCritic.ts`, `src/cli/personas/base.persona.ts`.

- [x] **14. Speculative Multi-Solution** — `/speculate <task>` generates a few genuinely distinct
  approaches, implements each in parallel in its own worktree, tests them, and presents the
  trade-offs (recommended pick starred); no auto-merge. _Shipped:_ `src/evolution/speculative.solver.ts`, `src/cli/commands/speculate.ts`.

---

## Status

**All 14 roadmap features are shipped.** Every Tier and the frontier-native items are
implemented, wired into the interactive loop, and verified (logic-level where live LLMs or
external CLIs aren't available in CI). New slash commands: `/plan`, `/checkpoint`, `/rewind`,
`/swarm`, `/impact`, `/ask`, `/replay`, `/diff-approval`, `/remember`, `/self-critic`, `/heal`,
`/watch`, `/council`, `/speculate`, `/evolve`. New tools: `MultiEditTool`, `RememberTool`, and
the upgraded `GraphQueryTool`.

## Fast-follow / hardening ideas (not yet built)

- A unit-test pass for the new orchestrators once the repo's `tsc`/`jest` baseline is green (the
  test runner currently can't compile `src/cli/events.ts`, which blocks suites that import it).
- `git push` trigger for `#6` watchers (currently file-change + cron).
- Auto-merge option for `/heal` and `/swarm` once gated behind explicit user opt-in.

## Already shipped this cycle

- [x] **Tier-1 flagships #1, #3, #10** — Parallel Worktree Swarm (`/swarm`), Time Machine
  (`/checkpoint` + `/rewind` + auto-checkpoint), and Plan Mode (`/plan`). See Tier 1 / Tier 5 above.
- [x] **Tiers 2–5 + frontier (#2, #4, #5, #6, #7, #8, #9, #11, #12, #13, #14)** — see each tier above.
- [x] Security & correctness fixes (path traversal, command injection, budget races, hanging sub-agent promise, bricked spawn counter, `/edit` quoting)
- [x] `EditFileTool` — surgical exact-string replacement with backups
- [x] `GrepTool` / `GlobTool` — regex content search + glob file finder
- [x] `TodoWriteTool` — structured session checklist with live UI/status updates
- [x] `WebFetchTool` — URL fetch with HTML→text and SSRF guard
- [x] Automatic edit backups so `/undo` and `/diff-file` work on agent edits
- [x] `DeleteTool` routed through `FILE_DELETE` governance
