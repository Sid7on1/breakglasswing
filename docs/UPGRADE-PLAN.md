# Bimax Upgrade Plan — Best-in-Class Feature Integration
## Derived from 9 Reference CLIs × 20 Research Dimensions (6-Tier Architecture)

**Reference CLIs analyzed:** Opencode, Claude Code, Hermes, Open Claw, Aider, Cline, Goose, KiloCode, Mistral Vibe  
**Architecture:** 6-tier strict-dependency model (Tier 1 = Primitives → Tier 6 = Observability)  
**Model:** BYOK open source — no payment, no billing, users bring their own API keys

---

## What Bimax Already Has (Confirmed Good)

| Feature | File |
|---|---|
| 4-layer ContextManager (capToolResults → microCompact → snip → LLM compact) | `src/memory/context.manager.ts` |
| Todo-gated loop persistence | `src/core/agent.loop.ts:265-277` |
| ThinkTagFilter — strips `<think>`/`<thinking>` from visible output | `src/core/llm.adapter.ts` |
| Multi-model routing (lite/heavy) | `src/core/llm.adapter.ts` |
| Parallel-safe / sequential-destructive tool dispatch | `src/core/agent.loop.ts:189` |
| Self-critic review-and-revise loop | `src/cli/selfCritic.ts` |
| Diff approval — visual diff before apply | `src/cli/diffApproval.ts` |
| Blast-gate — symbol risk gate on destructive edits | `src/cli/blastGate.ts` |
| Governance / sandbox / budget veto | `src/governor/` |
| Graph/LSP tool — AST-aware symbol lookup | `src/tools/implementations/graph.tool.ts` |
| Edit corruption guard | `src/tools/write-guard.ts` |
| Live token meter in TUI | `src/cli/screens/FullScreen.tsx:261` |

---

## Part A — Gaps Fixed (Best from Reference CLIs)

### Critical Broken Contracts

| Gap | Evidence | Best Reference |
|---|---|---|
| ReadFile reads entire file despite claiming truncation | `phase-02/bimax.md:7-11` — "factually false" | Opencode `tool/truncate.ts:43-125` |
| EditFile hard-fails when `oldString` stale; no fuzzy recovery | `edit.tool.ts:78-80` | Opencode/KiloCode Levenshtein threshold=0.65 |
| No file mtime guard before edit | — | Claude Code `FileEditTool.ts:291-311` |

### Context & Memory

| Gap | Best Reference |
|---|---|
| Duplicate read guard (3+ reads of same unmodified file → stub) | Cline `ReadFileToolHandler.ts:285-350` |
| Compact summary is a free-form JSON dump | Opencode `SUMMARY_TEMPLATE` (In Progress / Key Decisions / Next Steps / Critical Context) |
| No early warning before compaction | Mistral Vibe `ContextWarningMiddleware` at 50% |
| No Anthropic prompt caching headers | Aider `chat_chunks.py:24-44` — 60-80% input cost savings |

### Loop & Safety

| Gap | Best Reference |
|---|---|
| No tool-call loop detection | Cline LOOP_DETECTION_SOFT=3 / HARD=5 (toolName + argsHash) |
| No session checkpoint to disk | Cline `saveCheckpoint`, Mistral Vibe `RewindManager` |

### Planning

| Gap | Best Reference |
|---|---|
| No write-gated plan mode | Claude Code `EnterPlanModeTool.ts:101-118` |
| No specialized agent personas | KiloCode `agent.ts:140-293` (code / plan / explore / scout / general) |
| Speculative bash classifier not parallelized | Claude Code `startSpeculativeClassifierCheck` |

### Observability

| Gap | Best Reference |
|---|---|
| Token usage not broken down by category | Aider segments: system / conversation / tool results / current turn |

---

## Part B — New Unique Features (Not in Any Reference CLI)

These 6 features don't exist in Opencode, Claude Code, Hermes, Open Claw, Aider, Cline, Goose, KiloCode, or Mistral Vibe.

### B1 — Session Branching (`/branch`)

**What:** Git-style conversation branching. Create named checkpoints, explore an approach, revert to any branch and try something different — without losing other branches.

**Why unique:** Every reference CLI has at most a linear rewind/checkpoint. None has named branches with switch-back.

**How:**
```
/branch explore-approach-1    → saves current messages + todos to branch named "explore-approach-1"
/branch list                  → shows all branches with timestamps and turn counts
/branch switch <name>         → loads that branch's state (messages, todos, context)
/branch diff <a> <b>          → shows which files differ between two branches
```

**Implementation target:**
- `src/core/branch.manager.ts` (new) — save/load/list branches to `~/.bimax/branches/<sessionId>/<branchName>.json`
- Wire into `/branch` command in `src/cli/commands/builtins.ts`
- TUI shows current branch name in status bar

Effort: ~120 lines. This alone makes Bimax unique in the AI agent landscape.

---

### B2 — Grep→Read Fusion (Auto-Context)

**What:** When `SearchTool` returns ≤5 file:line results, automatically bundle the ±20 lines around each match into the same tool response. The model gets context without requiring a separate ReadFile round-trip.

**Why unique:** Every reference CLI treats grep and read as two separate tool calls. This merges them into one, saving an entire LLM round-trip on the most common pattern in coding workflows.

**How:**
- Add `autoExpand?: boolean` option to SearchTool (default: true)
- When `matches.length <= 5`: for each match, slice `[matchLine - 20, matchLine + 20]` from the file and append:
  ```
  --- Context: src/auth/login.ts:42 ---
  38: ...
  42: >>> const token = jwt.sign(payload, secret) <<<  (match)
  48: ...
  ```
- When `matches.length > 5`: return just the file:line list as today (too many to auto-expand)

**Implementation target:** `src/tools/implementations/search.tool.ts` — ~40 lines

Eliminates the single most common two-step pattern: `grep pattern → readFile lines X-Y`.

---

### B3 — Atomic Multi-File Edit Transactions (`/tx`)

**What:** Group multiple edits into a single atomic transaction. If any edit in the group fails, all previously applied edits in the group are automatically rolled back. Like database transactions but for file edits.

**Why unique:** Reference CLIs either do per-edit backup (Bimax already does this with `backupFile`) or git auto-commit (Aider). None have a "group of edits = one atomic unit" with auto-rollback on partial failure.

**How:**
```
/tx begin                     → opens a transaction, assigns an ID
(agent makes edits normally)  → each edit is tracked under the open transaction
/tx commit                    → finalizes (backup already happened per edit)
/tx rollback                  → restores all edited files in this transaction to pre-edit state
```

- If EditFileTool fails while a transaction is open: auto-rollback all edits made in this transaction and return a transaction failure message
- The model receives: `Transaction TX-4 rolled back: edit to auth.ts:89 failed (oldString not found). Reverted: [utils/token.ts, auth/session.ts]. Try again with a complete plan.`

**Implementation target:**
- `src/core/transaction.manager.ts` (new) — tracks `Map<txId, { path, originalContent }[]>`
- Wire into `EditFileTool` execute and `/tx` command
- Integrates with existing `backupFile` system

Effort: ~90 lines. Turns Bimax into a "safe by default" agent for multi-file refactors.

---

### B4 — Model-Driven Context Release (`FreeContextTool`)

**What:** A tool the model can call to explicitly drop specific files or topics from the context window — proactively, not just waiting for ContextManager to compact. The model says "I'm done with auth.ts, free it."

**Why unique:** Every reference CLI compacts context reactively (when full) or on a schedule. None let the model itself declare "I no longer need X" and immediately release it. This is a completely inverted control model.

**How:**
- New tool: `FreeContextTool({ files?: string[], reason?: string })`
- When called: finds all tool results in `this.messages` containing content from those file paths, replaces them with `[Context released by agent: ${reason}]`
- Compact counter resets for those files in the duplicate-read guard (Phase 2.1)
- Model receives confirmation: `Released context for: auth.ts, utils/token.ts (freed ~3,200 tokens)`

**Implementation target:**
- `src/tools/implementations/freecontext.tool.ts` (new) — ~50 lines
- Register in `src/tools/tool.factory.ts`
- Must be concurrency-safe (read-only from agent side), `isConcurrencySafe: true`

This is the only agent where the model can drive its own context budget.

---

### B5 — Parallel Speculation (`/speculate`)

**What:** Spawn N concurrent subagents with slightly varied instructions for the same problem. Each explores a different approach independently. Results show side-by-side; user (or model) picks the winner.

**Why unique:** Goose has subagents but linear. Bimax already has `subagent.manager.ts`. `/speculate` orchestrates them as a tournament — multiple parallel hypotheses, one winner. No reference CLI has this UX pattern.

**How:**
```
/speculate "refactor the auth module to use JWTs"
```
→ Spawns 3 subagents:
- Agent A: "Approach 1 — minimal change, adapt existing session handling"
- Agent B: "Approach 2 — full rewrite with clean interfaces"
- Agent C: "Approach 3 — incremental with compatibility shim"

→ Each agent runs in an isolated context (read-only; no writes until user picks)
→ Results shown in a diff-panel side-by-side
→ `accept A` applies Agent A's proposed changes

**Implementation target:**
- `src/cli/commands/speculate.ts` (new command) — ~80 lines
- Leverages existing `src/core/subagent.manager.ts`
- Subagents run with `planMode: true` (reads only) until user picks winner

This turns research uncertainty into parallel exploration.

---

### B6 — Post-Session Changelog (`/changelog`)

**What:** At any point (or auto-generated at session end), produce a structured developer-readable changelog: which files changed, what was added/removed, and a one-line summary of intent. Exportable as markdown.

**Why unique:** No reference CLI generates a structured session artifact. Aider shows git diffs; Claude Code has a session name. None produce a standalone changelog the developer can include in a PR description or commit message.

**How:**
```
/changelog              → generates and shows in TUI
/changelog export       → writes to ./CHANGES-<date>.md
/changelog copy         → copies to clipboard
```

Output format:
```markdown
## Session Summary — 2026-06-19 14:30

**Goal:** Refactor auth module to JWT

### Files Modified
- `src/auth/login.ts` (+42, -18) — replaced session cookies with JWT generation
- `src/auth/middleware.ts` (+15, -8) — updated token validation
- `src/utils/jwt.ts` (+67, -0) — new file: JWT sign/verify utilities

### Tests Affected
- `src/__tests__/auth.test.ts` — 3 new tests added

### Key Decisions
- Used RS256 algorithm (not HS256) for public-key verification compatibility
- Kept backward-compat session fallback for 30 days
```

**Implementation target:**
- `src/cli/commands/changelog.ts` (new) — ~90 lines
- Uses git diff to detect file changes (already using git in `git.tool.ts`)
- Pulls from session todo list for "Goal" and "Key Decisions"
- Pulls completed todos for the intent line

This is the artifact that closes the loop between "session" and "PR description."

---

## Implementation Phases

### Phase 1 — Foundation Integrity (Tier 1) `~105 lines`

**1.1 ReadFile Byte Limit + File Offload**  
Target: `src/tools/implementations/file.tool.ts:54-72`  
Add `MAX_FILE_BYTES = 100 * 1024` at read time. Files >100KB: save full to `os.tmpdir()/bimax-refs/<sha>.txt`, return first 100KB + reference path. Remove the false "handles truncation" claim.

**1.2 EditFile Fuzzy Levenshtein Recovery**  
Target: `src/tools/implementations/edit.tool.ts:78-80`  
When `oldString` not found: scan file in sliding windows equal to `oldString`'s line count. If best similarity ≥ 0.65: suggest closest match with line number. Pure JS, ~20 lines for the algorithm.

**1.3 File Modification Timestamp Guard**  
New: `src/tools/file-read-cache.ts`  
ReadFile: store `{ path, mtime }`. EditFile: stat before write, if `mtime` changed since last read → abort with targeted error. Eliminates the most common cause of corrupted edits.

---

### Phase 2 — Context Intelligence (Tier 3) `~65 lines + prompt`

**2.1 Duplicate Read Guard**  
Target: `src/tools/file-read-cache.ts` (Phase 1.3) + `file.tool.ts`  
Track `readCount` per path. After 3 reads of same unmodified file: return stub warning instead of full content.

**2.2 Structured Compact Template**  
Target: `src/memory/context.manager.ts:compact()` prompt  
Replace free-form JSON dump with structured sections: In Progress / Completed / Key Decisions / Critical Context / Next Steps. ~20-line prompt change.

**2.3 Context Warning at 50%**  
Target: `src/memory/context.manager.ts:checkAndCompact()`  
Inject one-time system message when estimated tokens cross 50% of window. Nudges agent to be conservative before forced compaction at 70%.

**2.4 Anthropic Prompt Caching Headers**  
Target: `src/core/llm.adapter.ts` (Anthropic provider path)  
Inject `cache_control: { type: "ephemeral" }` on system + large static content blocks. 60-80% input token cost reduction on long Anthropic sessions.

---

### Phase 3 — Loop Armor & Recovery (Tier 4) `~210 lines`

**3.1 Tool-Call Loop Detection**  
Target: `src/core/agent.loop.ts`  
Add `recentCalls` ring buffer. Key = `toolName + ':' + simpleHash(argsString)`. Soft warn at 3 identical calls, hard abort at 5. Integrates with `transientRetries` logic already present.

**3.2 Session Checkpoint / Rewind**  
New: `src/core/checkpoint.ts` + `/rewind` command  
Save session state (messages, todos) every 5 turns and after each successful write. `/rewind [N]` restores N turns back. `/rewind list` shows checkpoints.

**3.3 Session Branching** *(unique — B1)*  
New: `src/core/branch.manager.ts` + `/branch` command  
Named session branches. Save/load/switch/diff. TUI shows branch name. ~120 lines.

---

### Phase 4 — Smart Tool Operations (Tier 1 + 4) `~180 lines`

**4.1 Grep→Read Fusion** *(unique — B2)*  
Target: `src/tools/implementations/search.tool.ts`  
Auto-expand ≤5 grep matches to ±20 lines of context. Eliminates the grep→read round-trip. ~40 lines.

**4.2 Atomic Multi-File Transactions** *(unique — B3)*  
New: `src/core/transaction.manager.ts` + `/tx` command  
Track open transactions in EditFileTool. Auto-rollback all edits if any fail. ~90 lines.

**4.3 Model-Driven Context Release** *(unique — B4)*  
New: `src/tools/implementations/freecontext.tool.ts`  
`FreeContextTool({ files, reason })` — model explicitly drops context. Immediate token reclaim. ~50 lines.

---

### Phase 5 — Plan Gate & Agent Modes (Tier 5) `~160 lines`

**5.1 Write-Gated Plan Mode**  
New: `/plan` command + gate in EditFile/WriteFile/BashTool  
All writes blocked during plan mode. Uses `bash.analyzer.ts` risk classifier for bash. TUI shows `[PLAN MODE]` indicator. ~60 lines.

**5.2 Specialized Agent Personas**  
New: `src/core/agent-personas.ts` + `/mode explore|code|general` command  
- `explore`: read-only persona, maps territory with Graph/Search tools
- `code`: execution persona, minimal reads, targeted edits
- `general`: default (no suffix)
~50 lines.

**5.3 Parallel Speculation** *(unique — B5)*  
New: `src/cli/commands/speculate.ts`  
`/speculate "task"` → 3 concurrent read-only subagents, different approaches, user picks winner. ~80 lines.

---

### Phase 6 — Routing & Observability (Tier 2 + 6) `~140 lines`

**6.1 Speculative Bash Classifier**  
Target: `src/core/agent.loop.ts` + `src/security/yolo.classifier.ts`  
Fire classifier in parallel when BashTool call detected. Await cached result at execution time. ~30 lines.

**6.2 Token Usage by Category**  
Target: `src/memory/context.manager.ts` + `src/cli/commands/meta.ts`  
After compaction passes, track system / history / tool results / current-turn token splits. `/cost` shows category breakdown table. ~40 lines.

**6.3 Post-Session Changelog** *(unique — B6)*  
New: `src/cli/commands/changelog.ts`  
`/changelog` generates structured markdown: files changed (with +/-), git diff stats, goals from todos, key decisions. `/changelog export` writes to disk. ~90 lines.

---

## Priority Matrix

| Feature | Tier | Lines | Impact | Unique? |
|---|---|---|---|---|
| 1.1 ReadFile byte limit | 1 | 25 | Critical (correctness) | No |
| 1.3 File mtime guard | 1 | 30 | High (edit safety) | No |
| 1.2 EditFile fuzzy match | 1 | 50 | High (most common failure) | No |
| 2.1 Duplicate read guard | 3 | 20 | Medium (token savings) | No |
| 2.2 Structured compact | 3 | 20 | High (better summaries) | No |
| 2.3 Context warning 50% | 3 | 15 | Medium (early intervention) | No |
| 2.4 Anthropic caching | 2 | 30 | High (token cost) | No |
| 3.1 Loop detection | 4 | 40 | High (doom loop prevention) | No |
| 3.2 Checkpoint/rewind | 4 | 100 | Medium (recovery) | No |
| **3.3 Session branching** | 4 | 120 | High | **YES** |
| **4.1 Grep→read fusion** | 1 | 40 | High (round-trip elimination) | **YES** |
| **4.2 Atomic transactions** | 1+4 | 90 | High (safety) | **YES** |
| **4.3 FreeContextTool** | 1+3 | 50 | Medium (context control) | **YES** |
| 5.1 Plan mode gate | 5 | 60 | High (workflow) | No |
| 5.2 Agent personas | 5 | 50 | Medium (specialization) | No |
| **5.3 Parallel speculation** | 5 | 80 | High (exploration UX) | **YES** |
| 6.1 Speculative classifier | 2 | 30 | Medium (latency) | No |
| 6.2 Token breakdown | 6 | 40 | Medium (observability) | No |
| **6.3 Post-session changelog** | 6 | 90 | High (developer workflow) | **YES** |

**Recommended execution order (front-load correctness then uniqueness):**  
1.1 → 1.3 → 1.2 → 2.1 → 2.2 → 2.3 → 3.1 → **3.3** → **4.1** → **4.2** → **4.3** → 5.1 → **5.3** → 2.4 → 5.2 → 6.1 → **6.3** → 6.2 → 3.2

---

## What Makes Bimax Uniquely Best After This

After all phases, Bimax is the only agent with all of:

**From reference CLIs (best-in-class adoptions):**
- Byte-limited reads with offload reference (Opencode)
- Levenshtein fuzzy edit recovery (Opencode/KiloCode)
- File stale-read guard (Claude Code)
- Structured compact summaries (Opencode)
- Hard/soft loop detection (Cline)
- Write-gated plan mode (Claude Code)
- Speculative bash classifier (Claude Code)
- Anthropic prompt caching (Aider)

**Unique to Bimax (not in any reference CLI):**
- `/branch` — named session branches, switch between approaches
- Grep→read fusion — auto-expand matches to context in one call
- Atomic multi-file transactions — rollback on partial failure
- `FreeContextTool` — model-driven context release
- `/speculate` — parallel hypothesis tournament
- `/changelog` — structured session-to-PR artifact

**Already unique to Bimax (unchanged):**
- ThinkTagFilter — streaming reasoning filter
- Blast-gate — symbol risk gate on destructive edits
- Self-critic — review-and-revise pass
- Diff approval — visual diff before apply
- Genome/evolution system
- Multi-model routing with lite/heavy
- TUI with keybinding context stack
- MCP integration

No other agent CLI combines all of these.
