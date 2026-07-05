# Bimax vs Claude Code — Hot-Path Comparison & Techniques to Keep

Reference compared: deobfuscated Claude Code source at `~/Desktop/src` (1912 TS/TSX files;
`query.ts` 68KB, `QueryEngine.ts` 46KB, Ink renderer in `ink/`). Compared 2026-07-05, focused on
**hot paths**: the agent/query loop, context management, prompt caching, tool concurrency, and the
terminal render loop. This doc records techniques worth adopting and where Bimax is already ahead —
so nothing advanced is lost.

---

## A. ENGINE HOT PATH — techniques THEY have that we should adopt

### A1. Cache-aware micro-compaction by `tool_use_id` (HIGH value)
- **Them** (`query.ts:366–426`): a layered stack — `applyToolResultBudget` (per-tool aggregate
  result-size budget) → `snip` (HISTORY_SNIP) → `microcompact` → `autocompact`. Crucially,
  **microcompact operates purely by `tool_use_id` and never inspects content**, so replacing a stale
  tool result is *invisible to the Anthropic prompt cache* — compaction and caching compose cleanly.
  Cache-token accounting (`cache_read/creation/deleted_input_tokens`) defers the compaction-boundary
  message until the API reports actual deleted tokens.
- **Us** (`src/memory/context.manager.ts`): `checkAndCompact` summarizes older messages into one
  system note at 70% (`COMPACT_THRESHOLD`). This **rewrites the prefix → invalidates the prompt
  cache** on every compaction. We have an epoch/ABA guard but no id-addressed, cache-safe replacement.
- **Take-away**: add a cache-safe layer that shrinks *old tool results* addressed by id (replace with
  a short stub) BEFORE resorting to prefix-rewriting summarization. Keeps cache hits across compaction.

### A2. Streaming-window latency hiding (HIGH value)
- **Them** (`query.ts:1054`, `:323`): a **haiku (~1s) tool-use summary is resolved DURING the main
  model's 5–30s stream** (`pendingToolUseSummary`), so it's effectively free. Same trick for **skill-
  discovery prefetch and memory prefetch** — kicked off per-iteration and consumed once settled, "as
  many chances as there are loop iterations."
- **Us**: none. No speculative/prefetch work overlaps the stream (`grep` for prefetch/haiku-during-
  stream in `src/core` = empty).
- **Take-away**: run cheap side-work (tool-result summarization for the /subagents panel, next-step
  skill/graph prefetch, todo/plan updates) on the lite model concurrently with the main stream and
  consume when ready. Big perceived-latency win, ~free.

### A3. Layered overflow / 413 recovery cascade (MED value)
- **Them** (`query.ts:1064–1090`, `queryLoop`): on prompt-too-long, the streaming loop **withholds**
  the error, then tries **collapse-drain first** (cheap, keeps granular context) → **reactive compact**
  (full summary), single-shot each. Media-size (image/PDF) rejections get a **strip-retry** path.
  Plus **max-output-token escalation** (`ESCALATED_MAX_TOKENS`, bounded by
  `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT`).
- **Us** (`src/core/agent.loop.ts:159`): single reactive `compact-and-retry` on a context error. No
  graded cascade, no max-output escalation, no media strip-retry.
- **Take-away**: make reactive recovery a graded cascade (cheap→expensive, single-shot each) instead
  of one summary pass.

### A4. Comprehensive prompt-cache breakpoint placement (HIGH value, small change) — ✅ DONE 2026-07-05
Implemented: `applyCacheBreakpoints()` in `src/core/llm.stream.ts` marks BOTH the system message and
the conversation tail (handles string + array/tool-result content, skips tool-call-only tails); wired
into `llm.adapter.ts`. Tests in `capabilities.test.ts`. Below is the original finding.

- **Them**: cache breakpoints placed to cover the whole **stable conversation prefix** (system +
  tools + history up to the last turn), tracked with real cache-token usage.
- **Us** (`src/core/llm.adapter.ts:482`): we mark **only `finalMessages[0]`** ephemeral — so only the
  first/system message is cached; the growing conversation prefix is NOT. We're leaving most of the
  cache savings on the table.
- **Take-away**: also mark a breakpoint at the **last stable message before the new user turn** so the
  entire prefix is cached turn-to-turn. Cheap, high ROI.

### A5. Hot-path instrumentation
- **Them**: `queryCheckpoint('query_microcompact_start' | ...)` littered through the loop for precise
  timing/telemetry of each phase.
- **Us**: `/perf` gives coarse cold-start + TTFT. Consider per-phase checkpoints in the loop.

---

## B. ENGINE — where Bimax is at PARITY or AHEAD (keep ours)

- **Headroom Kompress ML compression** (`src/memory/headroom.compress.ts`) — a real torch-free ONNX
  compressor behind a proactive layer. Claude Code has **no ML compressor**; this is genuinely novel
  and worth keeping/promoting.
- **Layered cheap-first deterministic compaction** (cap tool results → dedupe → RepoMap → summarize)
  with an **epoch/ABA guard** — conceptually aligned with their snip/microcompact/autocompact tiers.
- **Concurrency-safe parallel tools** — we have `isConcurrencySafe` (`src/tools/tool.factory.ts`),
  matching their `isConcurrencySafe`/`isReadOnly` gating (`Tool.ts:402`).
- **Prompt caching present** — same `cache_control: ephemeral` mechanism (just placed less well, see A4).
- **Beyond Claude Code entirely** (no equivalent in `~/Desktop/src`): sandbox floor + typed outcomes +
  hash-chained SQLite event ledger + mind layer (self-model/drives/dream) + graph/codemem semantic
  index. These are Bimax-unique; keep.

---

## C. TUI HOT PATH — architecture tradeoff, largely at parity

Claude Code TUI is **React + Ink (alt-screen, virtualized viewport)**; Bimax TUI is **Go + Bubble Tea
(native scrollback via `tea.Println`)**. Different models, each with a real advantage.

| Aspect | Claude Code (Ink) | Bimax (Go) |
|---|---|---|
| Render coalescing | `throttle(deferredRender, FRAME_INTERVAL_MS)` (`ink/ink.tsx:213`) | `engineBatch` coalesce + 50ms `tickMsg` — **parity** |
| Committed output | Ink `<Static>` | `tea.Println` native scrollback — **parity in intent** |
| Scroll model | **Virtualized viewport** (`scrollTop` virtualization, `ink/styles.ts:371`) | Terminal-native scroll/copy/search — simpler, no virtualization |
| Memoization | `React.memo(Ansi)` | Go structs, no reconciler needed |
| Tool grouping | `GroupedToolUseContent`, `CollapsedReadSearchContent` | `toolRunSummary` (category counts) — parity, theirs slightly richer |

**The one real capability gap**: their virtualized alt-screen viewport lets them re-render the
transcript every frame, enabling **inline, in-place collapsible/interactive cards and an in-app
selection layer**. Our native-scrollback model is immutable once printed — which is exactly why the
sub-agent panel is bottom-pinned rather than inline. Their model is *more capable* (inline
interactivity) but heavier (Yoga layout + reconciler + virtualization + custom selection). Ours is
simpler and gets native terminal scroll/copy/search for free. **This is a deliberate tradeoff, not a
deficiency** — only revisit (alt-screen rewrite) if inline interactive cards become a hard requirement.

Worth borrowing from their TUI: **richer grouped/collapsed tool content** (group consecutive
read/search calls with an expandable summary) — a small, in-model improvement over our flat category
counts.

---

## C2. TOOL BREADTH — honest diff (corrected after reading, not skimming)

A tool-by-tool diff after actually reading `src/tools/implementations/` — several "gaps" from the
first pass were **already implemented** and are struck out here.

**Already present (my earlier audit was wrong):** ~~LSP~~ (`LspQueryTool` + real `src/lsp/client.ts`
JSON-RPC client + registry, diagnostics/references, graph-fused), ~~microcompaction~~ (`microCompact`
idempotent stubs), ~~graded recovery~~ (context/transient/unrecoverable tiers). Plus we match on
Agent/Spawn, AskUserQuestion, Skill, ToolSearch, Web*, File*, Glob/Grep/Todo, MCP-manage, Config
(Mode/Model), Plan.

**Genuine gaps — BUILT 2026-07-05:**
- ✅ **`TasksTool`** (`src/tools/implementations/tasks.tool.ts`) — `list` / `get` / `stop` for spawned
  sub-agents, exposing the blackboard + `SubAgentManager` to the orchestrator. Completes the
  map→reduce loop (was fire-and-forget). Parity with their `TaskList/TaskGet/TaskStop`. 7 tests.
- ✅ **`NotebookEditTool`** (`src/tools/implementations/notebook.tool.ts`) — cell-addressed Jupyter
  `.ipynb` editing (read/edit/insert/delete), preserving outputs + metadata. Parity with their
  `NotebookEditTool`. 6 tests.

**Remaining real gaps (deferred — niche, platform-specific, or need careful workflow integration):**
Worktree tools (we have `WorktreeManager` internally), REPLTool (stateful REPL), ScheduleCronTool
(needs a daemon), SendMessage/RemoteTrigger (inter-agent/remote), Team* (we have swarm), PowerShell
(Windows). Not padding the tool count with these until each earns its complexity.

## D. Prioritized recommendations

1. **A4 — full prefix cache breakpoint** (small change, big cost/latency win; we already have the mechanism).
2. **A1 — cache-safe tool-result compaction by id** (stops our compaction from nuking the cache).
3. **A2 — streaming-window prefetch/haiku side-work** (perceived-latency win; fits our lite-model routing).
4. **A3 — graded overflow recovery cascade** + max-output escalation.
5. **C — richer grouped/collapsed tool content** in the Go TUI.

Keep as-is (ahead/unique): Headroom ML compression, layered deterministic compaction + epoch guard,
sandbox/ledger/mind/graph subsystems, native-scrollback TUI model.
