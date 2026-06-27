# Bimax Grand Feature List — Amplify, Not Replace
## Strategic Principle: Only features that solve genuinely different problems. Every new feature must either fill a gap or feed an existing Bimax mechanism.

---

## What Bimax Already Has (Don't Touch)

| Feature | Why it stays |
|---|---|
| ThinkTagFilter | Best streaming reasoning separation of any CLI |
| blast-gate | Unique — no reference CLI has symbol-level impact analysis before edits |
| diff-approval | Best UX for edit visibility. New features feed it, not replace it. |
| self-critic loop | Internal review already handled. Verification agent adds the external/adversarial layer. |
| genome/evolution system | Unique. New features log signals into it. |
| ContextManager 4-layer stack | Keep the stack. RepoMap plugs into the top; Context Epoch wraps the compact step. |
| todo tool | Keep. GoalManager becomes its parent, not its replacement. |
| Multi-model routing | Keep. Routing precision work is additive. |
| MCP live enable/disable | Keep. Recipe YAML uses this as the toggle mechanism. |
| Keybinding context stack | Keep. |
| isConcurrencySafe + isDestructive per tool | Keep. |
| Transient retry in agent.loop.ts | Keep. Per-tool retry config is additive. |

---

## Section A: The Amplification Features
### New capabilities that make existing Bimax features smarter/stronger

---

### A1. RepoMap — Code Structure Feed for blast-gate and ContextManager
**Source:** Aider `repomap.py` — the single highest-leverage context feature in any CLI
**Problem it solves:** No Bimax feature reasons about symbol dependency graphs. blast-gate does naive grep. ContextManager dumps raw files.
**Integration:**

- **Feeds blast-gate**: tree-sitter parses the codebase into a symbol dependency graph. PageRank scores which identifiers are most central. blast-gate's risk analysis gets the actual call graph — not just "does this name appear in other files" but "which functions transitively depend on this symbol." Risk scores become accurate.
- **Feeds ContextManager**: Instead of injecting raw file contents at the capToolResults layer, inject a RepoMap outline. Same token budget covers the entire codebase's structure. `sqrt(num_refs)` penalty downscales generic high-frequency symbols. Files in the current chat get a 50x edge weight boost so they dominate.
- **Feeds blast-gate + Scout combo**: When blast-gate detects a public API symbol changed, pass that symbol's RepoMap edges to Scout for downstream impact inspection.

**Key mechanics:**
- tree-sitter parse of entire working tree (async, cached, invalidated on file mtime change)
- PageRank run on identifier reference graph
- Top-N tags selected by rank, formatted as `filename:line: identifier` outline
- Cache invalidated incrementally (only re-parse changed files)

**Files to touch:** `src/context/repomap.ts` (new), `src/tools/implementations/blast-gate.tool.ts` (feed it), `src/memory/context.manager.ts` (inject at cap layer)

---

### A2. 9-Step Edit Fallback + diff-approval surfaces the match method
**Source:** KiloCode `tool/edit.ts:702-738` — the most exhaustive edit recovery of any CLI
**Problem it solves:** Currently edit.tool.ts hard-fails when `oldString` not found. No recovery.
**Integration:**

- **Feeds diff-approval**: Each step of the fallback chain that succeeds passes its method name to the diff-approval UI. User sees `[APPROXIMATE MATCH — step 4: WhitespaceNormalized]` above the diff. They can approve or reject with full knowledge of how the match was made. diff-approval already exists — this just gives it richer context.
- **Feeds genome on step-N success**: If the model consistently needs step 5+ (IndentationFlexible), genome logs that this model tends to produce indentation-mismatched oldStrings and injects a reminder at the start of edit-heavy sessions.

**9 steps in order:**
1. Simple (exact match)
2. LineTrimmed (trim each line)
3. BlockAnchor (match by first + last non-empty line)
4. WhitespaceNormalized (collapse runs of whitespace)
5. IndentationFlexible (ignore leading indent delta)
6. EscapeNormalized (normalize escape sequences)
7. TrimmedBoundary (strip leading/trailing blank lines from oldString)
8. ContextAware (find by surrounding context, apply in middle)
9. MultiOccurrence (ask model which occurrence when >1 match found)

**Files to touch:** `src/tools/implementations/edit.tool.ts`, pass `matchMethod` to `src/ui/diff-approval.ts`

---

### A3. Verification Agent — chains after self-critic
**Source:** Claude Code `verificationAgent.ts` — adversarial external correctness testing
**Problem it solves:** self-critic is internal (same model, same blind spots). Verification agent is a separate adversarial agent that tries to break what was built.
**These are different signals. Both are needed.**

**Integration:**
- **Chains after self-critic**: self-critic runs first (internal fix pass) → verification agent runs on the fixed output (external adversarial pass) → only then task marked done
- **Feeds genome on FAIL**: When verification says `VERDICT: FAIL` on something self-critic cleared, log the gap to genome. Genome learns what self-critic consistently misses and tightens the self-critic prompt for those patterns.
- **Uses ThinkTagFilter**: Verification agent's deliberation stays in the `<think>` stream. Visible output is only: `VERDICT: PASS | FAIL | PARTIAL` + command output showing proof.

**Output format enforced:**
```
VERDICT: PASS
Command run: npm test -- auth.test.ts
Exit code: 0
Output: [last 20 lines]
```

**Files to touch:** `src/agents/verification.agent.ts` (new), `src/core/agent.loop.ts` (trigger after self-critic pass)

---

### A4. Loop Detection — logs to genome
**Source:** Cline (soft/hard thresholds) + Open Claw (SHA256 hashing) — combined best
**Problem it solves:** agent.loop.ts has filler guards but zero pattern-based loop detection.
**Integration:**

- **Logs to genome**: Every detected loop gets logged as a failure signature `{tool, argsHash, context_type}`. Genome builds a registry of loop-inducing patterns and injects avoidance context at session start.
- **Escalates to user (not crash)**: Soft threshold (3 repeats) → inject hint. Hard threshold (5 repeats) → surface `[LOOP DETECTED]` banner with continue/abort/switch-approach options.

**5 detector types:**
1. `generic_repeat` — same (tool, SHA256(args)) seen >= N times
2. `unknown_tool_repeat` — model calling non-existent tool repeatedly
3. `known_poll_no_progress` — same tool + same args + same result N times
4. `global_circuit_breaker` — total tool calls exceeds session budget
5. `ping_pong` — A→B→A→B tool alternation detected

**Files to touch:** `src/core/loop-detector.ts` (new), `src/core/agent.loop.ts` (plug in after each tool call), `src/genome/genome.ts` (receive loop log)

---

### A5. GoalManager — parent layer above todo tool
**Source:** Hermes `goals.py:143` — multi-state goal with SQLite persistence
**Problem it solves:** Todos are intra-session. When a session ends, all todo state is lost.
**Integration:**

- **todo tool becomes GoalManager's execution layer**: Active goal displayed as session header. Todos are how the current session executes that goal.
- **GoalManager states**: `active` → `paused` → `done` → `cleared`. State machine enforced.
- **Persists to SQLite**: `goals` table — id, title, state, turns_used, created_at, last_todo_state_json
- **Continuation prompt on resume**: On resume, GoalManager injects: "Previously: [goal]. Progress: [last N todos]. Resuming from: [last in_progress todo]."

**Files to touch:** `src/goals/goal.manager.ts` (new), `src/tools/implementations/todo.tool.ts` (add goal_id linkage), `src/db/session.db.ts` (new)

---

### A6. Context Epoch — wraps ContextManager compact step
**Source:** Opencode `context-epoch.ts`
**Problem it solves:** Race condition when model switch and compaction happen simultaneously. Currently unguarded.
**Integration:** Wraps the LLM compact call with an epoch counter. Operations that started before compaction check the epoch on write — if mismatched, re-derive from the compact result. No new UI. Pure internal safety for the existing ContextManager.

**Files to touch:** `src/memory/context.manager.ts` (add epoch counter + guard at compact entry point)

---

### A7. FileStateCache LRU — post-compact file restoration
**Source:** Claude Code `fileStateCache.ts`
**Problem it solves:** After compaction, the model re-reads files it already had. No tracking exists.
**Integration:**

- **Feeds ContextManager post-compact**: After LLM compact, re-inject recently-read files as synthetic `[FILE_STILL_UNCHANGED]` attachments. Model sees content without a tool call.
- **Feeds duplicate read guard**: Track `{path, mtime, offset, limit}`. Same mtime + same range = return cached result with stub note instead of disk read.

**Files to touch:** `src/memory/file-state-cache.ts` (new), `src/memory/context.manager.ts` (hook into compact), `src/tools/implementations/file.tool.ts` (check cache before disk)

---

## Section B: The Gap Fillers
### Features that solve problems Bimax doesn't touch at all

---

### B1. @file @folder @diff @staged References
**Source:** Hermes `context_references.py:62-103`
**Problem:** No inline context injection. User must rely on model calling ReadFile.

**Syntax:** `@auth.ts`, `@src/api/`, `@diff`, `@staged`, `@url https://...`

**Behavior:**
- Resolved before message hits the agent loop
- `@staged` → `git diff --staged` injected + blast-gate risk annotation appended automatically
- `@diff` → `git diff HEAD` injected
- `@file path` → file content injected
- `@folder path` → file tree injected
- `@url` → fetched + injected (with size cap)

**Files to touch:** `src/context/at-references.ts` (new), `src/core/message.preprocessor.ts` (new)

---

### B2. Planning Workflow + VCS Plan Files
**Source:** Opencode (5-phase workflow) + Claude Code (write gate)
**Problem:** Plans live only in conversation. No plan persistence, no VCS history of decisions.

**5-phase workflow:**
1. Initial Understanding — up to 3 parallel explore subagents
2. Design — synthesize findings
3. Review — self-critic pass on the plan itself
4. Write Plan File — save to `.bimax/plans/<timestamp>-<slug>.md`
5. Plan Exit — `plan_exit` tool lifts the write gate

**Write gate:** Every write/edit tool returns `[BLOCKED: in plan mode]` until `plan_exit` is called. Enforced at tool layer.
**blast-gate integration:** blast-gate pre-screens the entire plan's edits before `plan_exit` is allowed.

**Plan file format:**
```markdown
# Plan: <slug>
## Goal
## Approach
## Files to change
## Risk (blast-gate output)
## Steps
```

**Files to touch:** `src/tools/implementations/plan-exit.tool.ts` (new), `src/agents/plan.agent.ts` (new), `.bimax/plans/` dir

---

### B3. Scout Agent — Dependency Repo Inspection
**Source:** KiloCode `scout.txt:13-24`
**Problem:** No mechanism to analyze external repos or upstream dependencies.

**Behavior:**
- Read-only subagent — clones repos but never modifies
- Triggered automatically when blast-gate detects a changed public API
- Triggered manually: `/scout https://github.com/org/dep`
- Reports: exact file:line citations of code that would break
- blast-gate output gets a "Downstream Repos" block when Scout has run

**Files to touch:** `src/agents/scout.agent.ts` (new), `src/tools/implementations/blast-gate.tool.ts` (trigger Scout on public API change)

---

### B4. Recipe YAML — Configurable Agent Behavior
**Source:** Goose `recipe/mod.rs:43`
**Problem:** No way to define task-specific agent configurations without code changes.

**Format:**
```yaml
name: code-review
instructions: |
  Review staged changes for safety and correctness.
extensions: [mcp-github, mcp-linear]
sub_recipes: [scout, verify]
retry:
  on_failure: git stash
  max_attempts: 2
success_checks:
  - npm test
  - npm run lint
```

**Integration:**
- `extensions` uses MCP live enable/disable — recipe loading atomically enables listed servers
- `success_checks` feed into verification agent's final VERDICT
- Genome can tune `instructions` based on session outcomes

**Files to touch:** `src/recipes/recipe.loader.ts` (new), `src/commands/recipe.command.ts` (new)

---

### B5. /sessions — Cross-Session List and Resume
**Source:** Mistral Vibe `resume_sessions.py`
**Problem:** No session history. Sessions end and disappear.

**Behavior:**
- Every session end writes to SQLite: id, title, cwd, status, created_at, ended_at, goal_id, token_total
- `/sessions` — TUI table: title | cwd | date | status
- `/sessions resume <id>` — restores conversation + GoalManager goal + last todo state
- GoalManager continuation prompt injected as first message of resumed session

**Files to touch:** `src/db/session.db.ts` (new), `src/commands/sessions.command.ts` (new), `src/core/session.ts` (write metadata on end)

---

### B6. /speculate — Parallel Hypothesis Tournament
**Source:** Bimax-unique (planned)
**Problem:** For ambiguous tasks, one serial approach means you never know if a better path existed.

**Behavior:**
- Spawns N (default 3) parallel subagents, each with different framing/approach
- Each produces a plan (write gate active — no code changes yet)
- User sees side-by-side summary with trade-offs per approach
- User picks winner; winner exits plan-mode and executes
- blast-gate pre-screens each approach's plan before showing to user
- **Genome integration**: Winning approach type logged. Losing approaches logged as tried-and-rejected. Genome pre-selects approach type for similar future problems.

**Files to touch:** `src/commands/speculate.command.ts` (new), `src/agents/speculate.orchestrator.ts` (new)

---

### B7. /branch — Named Session Branching
**Source:** Bimax-unique (planned)
**Problem:** No way to explore a risky direction without losing current conversation state.

**Behavior:**
- `/branch <name>` — snapshots conversation + file state
- Work continues in branch; original preserved
- `/branch list` — all branches with divergence point
- `/branch switch <name>` — restore named branch
- **Genome integration**: Branch outcomes (merged/abandoned) logged. Consistently abandoned approaches signal a fundamental starting-point problem.

**Files to touch:** `src/branches/branch.manager.ts` (new), `src/commands/branch.command.ts` (new)

---

### B8. Grep→Read Fusion
**Source:** Bimax-unique (planned)
**Problem:** Model gets grep results then makes a separate ReadFile call — two tool calls for what should be one.

**Behavior:**
- After any grep/search call, if total matches <= 5, auto-expand each match to ±20 lines
- Return expanded context inline with grep result — no second tool call needed
- If matches > 5, return normal grep output
- **RepoMap integration**: Append RepoMap tags for matched symbols — model gets match + its place in dependency graph in one shot
- **FileStateCache integration**: Expanded context cached — if model reads same range later, return from cache

**Files to touch:** `src/tools/implementations/grep.tool.ts` (post-process), `src/memory/file-state-cache.ts` (cache expanded results)

---

### B9. FreeContextTool — Model-Driven Context Release
**Source:** Bimax-unique (planned)
**Problem:** Model has no way to say "I'm done with this context, release it." ContextManager decides eviction alone.

**Behavior:**
- Model calls `free_context({reason: "...", items: ["file:auth.ts", "tool_result:call_id_123"]})`
- Items removed from active context immediately
- Freed items marked `evicted_by_model` in FileStateCache — not restored post-compact
- **Genome integration**: If model consistently frees certain result types early, genome starts auto-compressing those types

**Files to touch:** `src/tools/implementations/free-context.tool.ts` (new), `src/memory/context.manager.ts` (handle freed items)

---

### B10. Atomic Multi-File Transactions
**Source:** Bimax-unique (planned)
**Problem:** Partial apply on multi-file edits leaves the codebase in broken state.

**Behavior:**
- `begin_transaction()` — all subsequent edits staged, not applied
- `commit_transaction()` — all staged edits applied atomically (or all fail and roll back)
- **diff-approval integration**: commit triggers combined diff-approval showing ALL staged edits as one unified diff
- **blast-gate integration**: blast-gate pre-screens the entire transaction before commit. Combined risk score shown in approval UI.
- **Suggestion**: Before large transaction, suggest `/branch pre-refactor` to preserve pre-transaction state

**Files to touch:** `src/tools/implementations/transaction.tool.ts` (new), `src/core/file.transaction.ts` (staging buffer)

---

### B11. /changelog — Post-Session PR Artifact
**Source:** Bimax-unique (planned)
**Problem:** After a long session, no structured summary of what changed and why.

**Behavior:**
- `/changelog` generates from session's todo completions + `git diff` since session start
- Uses lite model (same routing as session title generation)
- **GoalManager integration**: Active goal description becomes the "Why" section automatically
- **blast-gate integration**: High-risk edits flagged this session appear in "Breaking changes"
- **Genome integration**: Completed changelog saved as a session artifact

**Output:**
```markdown
## What changed
- [file:line] — what and why

## Why (from goal)

## Tests added/modified

## Breaking changes (from blast-gate log)

## Files touched
```

**Files to touch:** `src/commands/changelog.command.ts` (new), `src/agents/changelog.agent.ts` (new)

---

## Implementation Priority

### Phase 1 — Foundation (correctness, no new concepts)
| Item | Files | Effort |
|---|---|---|
| 9-step edit fallback (A2) | `edit.tool.ts` | 3 days |
| ReadFile byte limit + offload | `file.tool.ts` | 1 day |
| FileStateCache LRU (A7) | `file-state-cache.ts` + `context.manager.ts` | 2 days |
| Context Epoch (A6) | `context.manager.ts` | 1 day |
| Loop detection → genome (A4) | `loop-detector.ts` + `agent.loop.ts` | 2 days |
| Structured SUMMARY_TEMPLATE | `context.manager.ts` prompt | 0.5 days |

### Phase 2 — Context Intelligence
| Item | Files | Effort |
|---|---|---|
| RepoMap (A1) | `repomap.ts` + blast-gate + ContextManager | 5 days |
| @references (B1) | `at-references.ts` + `message.preprocessor.ts` | 2 days |
| Grep→Read fusion (B8) | `grep.tool.ts` | 1 day |
| FreeContextTool (B9) | `free-context.tool.ts` + `context.manager.ts` | 1 day |
| Anthropic prompt caching | `llm.adapter.ts` | 1 day |

### Phase 3 — Session Continuity
| Item | Files | Effort |
|---|---|---|
| GoalManager (A5) | `goal.manager.ts` + `session.db.ts` | 3 days |
| /sessions (B5) | `sessions.command.ts` + `session.db.ts` | 2 days |
| /branch (B7) | `branch.manager.ts` + `branch.command.ts` | 3 days |
| Atomic transactions (B10) | `transaction.tool.ts` + `file.transaction.ts` | 2 days |

### Phase 4 — Planning + Agents
| Item | Files | Effort |
|---|---|---|
| Planning workflow + VCS plan files (B2) | `plan.agent.ts` + `plan-exit.tool.ts` | 3 days |
| Verification agent (A3) | `verification.agent.ts` + chain after self-critic | 2 days |
| Scout agent (B3) | `scout.agent.ts` + blast-gate trigger | 2 days |
| /speculate (B6) | `speculate.command.ts` + `speculate.orchestrator.ts` | 3 days |

### Phase 5 — Genome Integration + Recipes
| Item | Files | Effort |
|---|---|---|
| Loop → genome logging | `loop-detector.ts` → `genome.ts` | 0.5 days |
| Verification FAIL → genome | `verification.agent.ts` → `genome.ts` | 0.5 days |
| /speculate winner → genome | `speculate.orchestrator.ts` → `genome.ts` | 0.5 days |
| Recipe YAML (B4) | `recipe.loader.ts` + MCP hooks | 2 days |
| /changelog (B11) | `changelog.command.ts` + `changelog.agent.ts` | 1 day |

### Phase 6 — Observability
| Item | Files | Effort |
|---|---|---|
| Cache token tracking | `llm.adapter.ts` | 0.5 days |
| Step cost + latency per tool | `agent.loop.ts` | 1 day |
| OTLP spans | `src/telemetry/otlp.ts` | 2 days |

---

## What Makes Bimax Superior

1. **The only CLI with symbol-level blast-gate** — powered by RepoMap's real call graph, not grep
2. **The only CLI with genome-informed loop avoidance** — learns from its own failure patterns across sessions
3. **The only CLI with a three-layer correctness stack**: self-critic (internal) → verification agent (adversarial external) → success checks (shell-based)
4. **The only CLI with parallel hypothesis testing** that feeds genome — /speculate evolves the agent
5. **The only CLI where blast-gate + Scout + atomic transactions form a coherent safety pipeline** — risk analysis, downstream impact, and rollback protection all connected
6. **The only CLI with session branching + multi-session goal persistence** — long-running work survives
7. **BYOK open source** — no billing, no telemetry to Bimax, users own everything
