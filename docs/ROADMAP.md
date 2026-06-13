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

- [ ] **1. Parallel Worktree Swarm** — Decompose a request into a DAG (`TaskDecomposer`),
  spawn each independent node as a sub-agent in its own git worktree (`WorktreeManager`),
  run in parallel, auto-merge on dependency completion. Zero file collisions.
  _Leverages:_ TaskDecomposer + SubAgentManager + WorktreeManager. _Effort:_ L · _Risk:_ M.

- [ ] **2. Council of Models (cross-CLI ensemble)** — Send one task to multiple external AI
  CLIs via `TerminalMultiplexer`, judge candidates by running each against the test suite
  in a throwaway worktree, keep the winner.
  _Leverages:_ TerminalMultiplexer + adapters + Tester. _Effort:_ M · _Risk:_ M.

- [ ] **3. Time Machine (checkpoint & rewind)** — `/checkpoint` snapshots the working tree
  before each turn; `/rewind` restores any earlier state or forks a new attempt from it.
  _Leverages:_ Versioner + backup store + git. _Effort:_ M · _Risk:_ Low.

## Tier 2 — Code intelligence

- [ ] **4. Blast-Radius Preview** — Before applying an edit, query `ImpactEngine` to report
  downstream reach and flag high-criticality nodes; confirm-or-refuse on large blast radius.
  _Effort:_ M · _Risk:_ Low.

- [ ] **5. Ask-the-Architecture** — Natural-language questions answered from the cognitive
  graph + semantic metadata instead of blind file reads. _Effort:_ M · _Risk:_ Low.

## Tier 3 — Autonomy

- [ ] **6. Background Watchers** — `/watch` a condition (file change, schedule, git push) and
  wake the agent to act (keep tests green, triage issues). Budget governor as circuit breaker.
  _Leverages:_ cron/webhook executors + BudgetVeto. _Effort:_ M · _Risk:_ M.

- [ ] **7. Self-Healing Test Loop** — On save, run tests; on red, spawn a fix agent in a
  worktree, verify green, surface the patch for approval.
  _Leverages:_ Tester + WorktreeManager + SubAgentManager. _Effort:_ M · _Risk:_ M.

## Tier 4 — Memory & self-improvement

- [ ] **8. Self-Writing Project Memory** — Auto-extract conventions/decisions/gotchas into the
  vector store and inject relevant ones into context each turn (a self-maintaining CLAUDE.md).
  _Leverages:_ VectorStore + LongTermMemory. _Effort:_ M · _Risk:_ Low.

- [ ] **9. Genome Self-Evolution** — Agent proposes improvements to its own source, tests them
  in a worktree, merges only if guardian contracts pass. Gated behind explicit opt-in.
  _Leverages:_ genome/ + guardian/ + evolution/. _Effort:_ L · _Risk:_ High.

## Tier 5 — UX wins

- [ ] **10. Plan Mode** — Activate the governor's existing `'plan'` mode: research and propose a
  plan touching nothing, approve, then execute. _Effort:_ S · _Risk:_ Low.

- [ ] **11. Inline Diff Approval** — Render proposed edits as a reviewable diff (`DiffView`
  exists) with accept/reject instead of fire-and-forget writes. _Effort:_ M · _Risk:_ Low.

- [ ] **12. MultiEditTool + Session Replay** — Atomic batch multi-edits in one call; export a
  session as a shareable markdown report. _Effort:_ S each · _Risk:_ Low.

## Frontier-model-native

- [ ] **13. Self-Critic Loop** — After drafting, the model critiques its own diff against tests
  and requirements before presenting. _Effort:_ M.

- [ ] **14. Speculative Multi-Solution** — For hard problems, generate 2–3 distinct approaches
  in parallel, test each, present trade-offs. Pairs with #1. _Effort:_ M.

---

## Recommended build order

1. **#10 Plan Mode** — nearly free (enum already exists), immediate value.
2. **#3 Time Machine** — safety unlock that de-risks everything after it.
3. **#1 Parallel Worktree Swarm** — the flagship; the hard infra already exists.

## Already shipped this cycle

- [x] Security & correctness fixes (path traversal, command injection, budget races, hanging sub-agent promise, bricked spawn counter, `/edit` quoting)
- [x] `EditFileTool` — surgical exact-string replacement with backups
- [x] `GrepTool` / `GlobTool` — regex content search + glob file finder
- [x] `TodoWriteTool` — structured session checklist with live UI/status updates
- [x] `WebFetchTool` — URL fetch with HTML→text and SSRF guard
- [x] Automatic edit backups so `/undo` and `/diff-file` work on agent edits
- [x] `DeleteTool` routed through `FILE_DELETE` governance
