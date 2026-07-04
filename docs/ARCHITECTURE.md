# BiMax — Complete Architecture & Subsystem Reference

This is the exhaustive reference: **every subsystem, every tool, every command**, what it
is, how it works, and why it matters. For the highlight reel see [FEATURES.md](./FEATURES.md).

Source layout (`src/`): `core` `cli` `tools` `governor` `memory` `graph` `genome`
`evolution` `sandbox` `task` `actions` `api` `auth` `plugins` `credits` `providers`
`telemetry` `terminal` `storage` `state` `security` `config` `utils`.

---

## 1. Runtime & entry

- **`src/index.ts` / `src/cli/index.ts`** — CLI entry. Parses flags (`-p/--print`,
  `--print-with-tools`, `--dangerously-skip-permissions`, agent, model), loads env
  (`src/cli/env.loader.ts`, which reads `~/.breakglass/.env`), boots the DI container, and
  either drives the engine over the NDJSON stdio protocol for the Go/Bubble Tea TUI (the sole
  interactive front-end; see §13) or runs one-shot print mode.
- **`src/core/container.ts`** — the **dependency-injection container**. Wires the entire
  graph in one factory: event bus, telemetry, DB, governor, LLM adapter, tool registry,
  graph store, memory, coordinator/worker, task pipeline. One place to understand how
  everything connects.
- **`src/core/bootloader.ts`** — ordered startup (validate env → telemetry → DB → API →
  auth → ready). **`src/core/shutdown.coordinator.ts`** — idempotent graceful shutdown
  (teardown hooks run once on SIGINT/SIGTERM).
- **`src/core/event.bus.ts`** — internal pub/sub used across subsystems; has an error
  handler so a bad listener can't crash the process.
- **`src/core/correlation.ts`** — attaches a correlation id to async work for traceable
  logs. **`src/core/errors.ts`** — typed errors (`AppError`, `GovernorVetoError`).

## 2. The agent loop & LLM layer (`src/core`)

- **`agent.loop.ts` — `AgentLoop`**: the heart. Streams a turn, surfaces tokens/thinking,
  executes tool calls (parallel for concurrency-safe tools, sequential for destructive),
  feeds results back, and iterates to a configurable max. Includes the output-contract
  sanitizer, regenerate-on-empty guard, and text-tool-call recovery.
- **`llm.adapter.ts` — `LlmAdapter`** (implements `LLMProvider`): the OpenAI-compatible
  client used for every provider. Streaming `chat()` with tool calls + usage; helpers
  `generateTinyPlans` (JSON plans), `generateChatResponse`, `chatCompletion`,
  `generateSemanticMetadata`. Contains:
  - **`ThinkTagFilter` / `stripThink`** — separate `<think>…</think>` reasoning from the
    visible reply (reasoning-model support), plus the `reasoning_content` channel.
  - **`extractJson`** — pull balanced JSON out of fenced/prose model output.
  - **Budget hooks** — reserve/record/release spend around every call.
  - **Stream-read watchdog** (`BGW_STREAM_TIMEOUT_MS`) and request timeout (`BGW_TIMEOUT`).
  - Optional **`reasoning_effort`** (`BGW_REASONING_EFFORT`), `temperature`, `maxTokens`.
- **`response.sanitizer.ts` — `ResponseSanitizer`**: strips leaked tool-meta filler ("No
  function call is needed…") and reports when a turn was *only* filler so the loop can
  regenerate. **`tool.call.parser.ts`** — recovers tool calls a model wrote as plain JSON.
- **`llm.provider.ts`** — the `LLMProvider`/`Message`/`ChatOptions`/`ChatEvent` contract.

## 3. Tools (`src/tools`)

`tool.registry.ts` (`ToolRegistry`) holds tools; `tool.factory.ts` builds them with
governor gating, destructive/concurrency flags, and schema. Every tool the model can call:

| Tool | What it does |
|---|---|
| **BashTool** | Run shell commands (installs, builds, git, processes); risk-classified. |
| **ReadFileTool** | Read a file. |
| **WriteFileTool** | Create/overwrite a file (auto-backed-up via the undo system). |
| **EditFileTool** | Exact search/replace edit in a file. |
| **MultiEditTool** | Multiple edits in one file atomically. |
| **DeleteTool** | Delete a file (governed `FILE_DELETE`). |
| **GrepTool** | Content search across files. |
| **GlobTool** | Filename/pattern search. |
| **ChangeDirectoryTool** | Change the working directory (not `cd` in Bash). |
| **WebFetchTool** | Fetch a URL → text, with SSRF protection (blocks localhost/internal IPs) and a 30s timeout. |
| **GraphQueryTool** | Query the live code graph. |
| **MemoryQueryTool** | Semantic search over long-term memory. |
| **RememberTool** | Save a durable project memory (convention/decision/gotcha). |
| **TodoWriteTool** | Maintain a live task checklist rendered in the UI. |
| **SpawnSubagentTool** | Spawn a sub-agent worker for a sub-task. |
| **RegisterAgentTool** | Register a newly-installed CLI as a new agent persona. |
| **AskUserTool** | Ask the user a real decision (only when genuinely blocked). |

## 4. Governor & security (`src/governor`, `src/security`)

Multi-layer permission engine; every risky tool call passes through it.
- **`governor.ts` — `Governor`**: orchestrates the layers and modes — `interactive`,
  `auto`, `strict`, `plan` (read-only), `bypass` (YOLO). Emits `veto_prompt` to the UI.
- **`bash.analyzer.ts` — `BashStaticAnalyzer`**: classifies command risk (e.g. `rm -rf`,
  `curl | bash` → high; `npm install` → medium; `ls` → none).
- **`security/yolo.classifier.ts` — `YoloClassifier`**: ML-style risk classification for
  ambiguous cases in `auto` mode (LLM-backed).
- **`budget.veto.ts` — `BudgetVeto`**: **hard daily spend cap** (default $5, `MAX_DAILY_SPEND`),
  mutex-guarded reserve→record→release accounting, persisted to `.breakglass/credits/spend.json`,
  auto-reset per day.
- **`fs.veto.ts` — `FileSystemVeto`**: confines edits to the workspace root, blocks
  forbidden paths/extensions.
- **`policy.engine.ts` — `SafetyPolicy`**: central policy constants (limits, caps).

## 5. Memory stack (`src/memory`)

- **`short.term.ts` — `ShortTermMemory`**: working message buffer with pruning that
  preserves system messages.
- **`vector.store.ts` — `VectorStore`** + **`embeddings.ts` — `EmbeddingsGenerator`** +
  **`long.term.ts` — `LongTermMemory`**: semantic long-term memory (offline embedding +
  similarity search).
- **`project.memory.ts` — `ProjectMemory`** (`globalProjectMemory`): durable per-project
  conventions/decisions/gotchas; `recallBlock()` injects relevant memories into each turn's
  system prompt. Backed by `/remember` and `RememberTool`.
- **`context.engine.ts` — `ContextEngine`**: blends short + long term for the working set.
- **`context.manager.ts` — `ContextManager`**: token accounting and **auto-compaction**
  (summarize older turns at ~70% capacity) without splitting tool-call/result pairs;
  reactive compaction on context-length errors.

## 6. Code graph & genome (`src/graph`, `src/genome`)

- **`graph.store.ts` — `GraphStore`** (`models.ts`: `GraphNode`/`GraphEdge`): persistent
  graph of the codebase (`.breakglass/graph/`).
- **`static.analyzer.ts` — `StaticAnalyzer`** + **`indexer.ts` — `CodebaseIndexer`**: parse
  source into nodes/edges (AST structure) — `/index`.
- **`semantic.augmenter.ts` — `SemanticAugmenter`**: LLM-derived metadata per node
  (purpose, criticality, risk score) — `/index-ai`.
- **`graph.observer.ts` — `GraphObserver`**: keeps the graph fresh as files change.
- **`impact.engine.ts` — `ImpactEngine`** (`BlastRadiusReport`): **blast-radius** analysis —
  what depends on a symbol/file — powers `/impact`.
- **`cognitive.graph.ts` — `CognitiveGraph`**: higher-level reasoning over the graph;
  powers `/ask` (answer architecture questions from the graph).
- **`genome/genome.repository.ts`**: the **architecture genome** — `components.json`,
  `contracts.json`, `permissions.json` describing BiMax's own components and the contracts
  they must honor.
- **`genome/guardian.ts` — `ArchitectureGuardian`**: validates a candidate change against
  its component contract (e.g. required emitted events) — the hard gate for `/evolve`.

## 7. Multi-agent orchestration (`src/evolution`, `src/core`)

All run in **isolated git worktrees** so your branch is never touched until you merge.
- **`worktree.manager.ts` — `WorktreeManager`**: create/commit/merge/remove worktrees via
  `execFile` (no shell — injection-safe). Shared by all four features below.
- **`subagent.manager.ts` — `SubAgentManager`**: spawns sub-agents as **worker threads**
  (`src/cli/worker.entry.ts`), with a **watchdog timeout** (`BGW_WORKER_TIMEOUT_MS`) so a
  hung worker can't block the parent.
- **`swarm.orchestrator.ts` — `SwarmOrchestrator`** (`/swarm`): decompose → topological
  "waves" → parallel workers → merge to an integration branch.
- **`speculative.solver.ts` — `SpeculativeSolver`** (`/speculate`): propose N distinct
  approaches → implement each in parallel → test → recommend the best.
- **`council.orchestrator.ts` — `CouncilOrchestrator`** (`/council`): run rival external AI
  CLIs (claude/gemini/opencode/bimax), judge by your test suite, keep the winner.
- **`genome.evolver.ts` — `GenomeEvolver`** (`/evolve`): edit BiMax's own source under the
  Architecture Guardian; type-check + test; keep on a branch only if the guardian passes.
- **`core/coordinator.ts` / `worker.agent.ts`**: the event-driven dispatcher + worker used
  for autonomous parallel sub-task execution (retries failed sub-tasks up to 3×).

## 8. Sandbox & safety (`src/sandbox`)

- **`checkpoint.manager.ts` — `CheckpointManager`** (`globalCheckpointManager`): the **Time
  Machine** — snapshot (`/checkpoint`) and restore (`/rewind`) the working tree; manual ★
  and auto checkpoints.
- **`test.healer.ts` — `TestHealer`** (`/heal`): run tests; if red, a fix agent iterates in
  a worktree until green, then surfaces the patch on a branch.
- **`rollback.ts` — `Rollback`** + **`versioner.ts` — `Versioner`**: backup/restore for
  edits (powers `/undo`, `/backups`, `/diff-file`).
- **`fs.adapter.ts`**, **`validator.ts`**, **`tester.ts`**, **`index.ts` — `SandboxManager`**:
  filesystem abstraction, candidate validation, and test execution used by the sandboxed
  flows above.

## 9. Autonomous mode (`src/task`, `src/core`, `src/api`, `src/actions`, `src/auth`)

BiMax can run as a long-lived autonomous service, not just an interactive chat:
- **`task/index.ts` — `TaskPipeline.process()`**: turns an incoming request into structured
  work via **`classifier.ts`** (TaskClassifier) → **`decomposer.ts`** (TaskDecomposer, DAG)
  → **`mapper.ts`** (TaskMapper). `types.ts` defines the Zod schemas.
- **`core/cognitive.loop.ts` — `CognitiveLoop`**: the always-on brain — `start()`,
  `processTask()`, `stop()`.
- **`core/orchestrator.ts` — `Orchestrator`** + **`coordinator.ts`/`worker.agent.ts`**:
  dispatch decomposed sub-tasks to workers concurrently and aggregate results.
- **`api/webhook.receiver.ts` — `WebhookReceiver.startListening(port)`**: receive external
  webhooks that kick off tasks.
- **`actions/action.router.ts` — `ActionRouter.route()`** with executors:
  **`executor.cron.ts`** (scheduled), **`executor.trigger.ts`** (event), **`executor.webhook.ts`**
  (HTTP), **`executor.graph.ts`** (graph-driven). Powers `/watch` (wake the agent on a file
  change or schedule).
- **`auth/cli.login.ts` — `AuthAutomator`**: automates CLI login flows for integrated tools.

## 10. Plugin system (`src/plugins`)

Install and integrate third-party capabilities **directly from GitHub**:
- **`index.ts` — `PluginManager.installFromGithub(url)`**: the entry point.
- **`github.api.ts` / `github.reader.ts` / `github.analyzer.ts`**: fetch and **analyze a
  repo's codebase** (capabilities, risk, license).
- **`plugin.evaluator.ts` — `PluginEvaluator.evaluate()`**: score a plugin by risk level,
  capabilities, and license before trusting it.
- **`plugin.sandbox.ts` / `plugin.integrator.ts` — `PluginIntegrator.integrate()`**: run and
  wire an approved plugin in a sandbox.
- **`registry.ts` — `PluginRegistry`** (`PluginManifest`): tracks installed plugins.
**Benefit:** extend BiMax with community tools, vetted for risk/license first.

## 11. Providers & credits (`src/cli/provider.ts`, `src/credits`)

- **`provider.ts`**: six built-in providers (NVIDIA, OpenAI, Anthropic, OpenRouter,
  DeepSeek, Google); `buildKeyPool()` reads comma-separated keys and per-key model overrides
  (`<ENV>_MODEL_<n>`). `/provider`, `/model`, `/keys`.
- **`credits/api.key.manager.ts` — `ApiKeyManager`**: **round-robin key pool** with
  per-key cooldowns and 429/403/401/timeout backoff; mutex-guarded; skips exhausted keys.
- **`credits/credits.free.ts` — `FreeCreditsTracker`** and **`session.tracker.ts` —
  `SessionTracker`**: track free credits and per-session usage; power `/cost`.

## 12. Persistence & state (`src/storage`, `src/state`)

- **`storage/db.connection.ts` — `DatabaseConnection`**: local event/session store.
- **`storage/state.sync.ts` — `StateSyncEngine`**: file-stat-based sync of working state.
- **`state/app.state.ts` / `store.ts`**: the UI's reactive store (`MessageEntry`,
  `LogEntry`, `ToolCallEntry`); bridges `cliEvents` → UI. Session save/resume (`/sessions`,
  `/resume`) and transcript replay (`/replay`) persist to `.breakglass/`.

## 13. Terminal & UI (`tui/`, `src/protocol`)

The interactive front-end is a **Go / Bubble Tea TUI** in `tui/` (the earlier React/Ink UI
was retired). The engine speaks to it out-of-process over an NDJSON stdio protocol
(`src/protocol/`), so the front-end can be swapped without touching engine logic.

- **`tui/model.go`**: the Bubble Tea model — inline mode (committed lines flushed to the
  terminal's native scrollback via `tea.Println`; only the live region re-renders), streaming
  area, resize/hardwrap guards, footer.
- **`tui/`** render units: `diff.go` (colorized diff cards), `tools.go` (fixed-slot tool
  cards), `markdown.go`, `panels.go`, `mindhud.go` (Ctrl+X second-mind HUD), `styles.go`
  (Graphite & Phosphor tokens), `search.go`, `welcome.go`.
- **`src/protocol/ui.snapshot.ts`**: engine-side footer/HUD state snapshotted for the
  out-of-process front-end to read.
- **Themes** (`cli/themes.ts` + `themes/*.json`): dark, light, ANSI, daltonized, bimax,
  dracula, catppuccin, gruvbox, nord. Switchable via `/config`.
- **`terminal/multiplexer.ts` — `TerminalMultiplexer`** + **`queue.ts` — `CommandQueue`**:
  manage multiple terminal sessions and a serialized command queue.

## 14. Telemetry & health (`src/telemetry`)

- **`metrics.ts` — `TelemetryEngine`**: metrics collection.
- **`memory.monitor.ts` — `MemoryMonitor`**: watches process memory and warns on pressure.
- **`watchdog.ts` — `Watchdog`**: liveness watchdog for long-running/autonomous runs.

## 15. Skills (`skills/*.json`, `src/cli/personas`)

Personas are agents with a role + allowed tools. Built-ins: **BiMax** (orchestrator),
**Hermes** (read/search/exec), **OpenCode** (deep coding), **OpenClaw** (OS execution).
JSON **skills** add specialized personas without code:
- **DreamSkill** — *memory distillation*: compress long logs/events into dense memory so
  long-term context isn't lost.
- **EvolutionSkill** — *autonomous self-evolution*: find weak components and rewrite them,
  strictly obeying the Architecture Guardian.
`RegisterAgentTool` registers any installed CLI as a new persona at runtime; `/routes` sends
matching prompts to the right specialist.

---

## 16. Full command reference

**Core/session:** `/help` `/clear` `/context` `/cost` `/config` `/sessions` `/resume` `/replay`
**Model/provider:** `/model` `/provider` `/keys`
**Files & VCS:** `/edit` `/write` `/diff` `/diff-file` `/undo` `/backups` `/git` `/log`
**Quality:** `/lint` (tsc) `/check` (eslint) `/self-critic`
**Code intelligence:** `/index` `/index-ai` `/ask` `/impact`
**Multi-agent:** `/swarm` `/speculate` `/council` `/evolve` `/heal`
**Time machine:** `/checkpoint` `/rewind`
**Memory:** `/remember`
**Agents/routing:** `/agents` `/skills` `/routes`
**Safety/modes:** `/governor` `/plan` `/diff-approval` `/agent-decisions`
**Automation:** `/watch`

## 17. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `NVIDIA_API_KEY` (and other `*_API_KEY`) | — | Comma-separated key pool per provider |
| `<ENV>_MODEL_<n>` | provider default | Per-key model override |
| `BGW_PROVIDER` | `nvidia` | Active provider |
| `BGW_MODEL` | `meta/llama-3.1-70b-instruct` | Active model |
| `BGW_TIMEOUT` | `120000` | Request timeout (ms) |
| `BGW_STREAM_TIMEOUT_MS` | `60000` | Per-chunk stream stall guard |
| `BGW_WORKER_TIMEOUT_MS` | `600000` | Sub-agent worker watchdog |
| `BGW_TEMPERATURE` | `0.1` | Sampling temperature |
| `BGW_MAX_TOKENS` | `4096` | Max completion tokens |
| `BGW_REASONING_EFFORT` | unset | `low`/`medium`/`high` for thinking models |
| `MAX_DAILY_SPEND` | `5.00` | Hard daily budget cap (USD) |
| `WORKSPACE_ROOT` | cwd | Allowed edit scope |

Config also persists in `.breakglass/config.json`; per-project data lives under `.breakglass/`.
