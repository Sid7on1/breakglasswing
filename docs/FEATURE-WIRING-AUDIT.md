# Feature Wiring Audit

Date: 2026-06-21. Question for each feature: is it actually wired end-to-end (engine → protocol → TUI) and does it work, or is it registered/declared but dead/stub/broken?

Method: traced the live object graph from `createContainer()`, the 62 registered slash commands, the 28 registered tools, and each subsystem's instantiation + invocation path.

---

## ✅ Confirmed LIVE & working (verified this session or clearly wired)

| Feature | Path | Notes |
|---|---|---|
| LLM chat (NIM) | container → LlmAdapter | Verified live: coding=minimax-m3, lite=step-3.7-flash answer 200 |
| Streaming tool calls | LlmAdapter.chat | Fixed + verified (index accumulation) |
| Web search / fetch | core tools, lite DDG endpoint | Verified live, now core (no ToolSearch dance) |
| Model picker / provider | /model, /provider, healModel | Verified; single-provider pool |
| 28 tools | container registers all | read/write/edit/multiedit/delete/bash/grep/glob/git/cd/todo/ask/skill + web + graph + memory + lsp + mcp + scout + spawn + plan + goals + register + remember |
| Sub-agents | SpawnSubagentTool → globalSubAgentManager.spawnWorker (worker threads) | Real path is SubAgentManager, NOT the dead worker.agent |
| Graph/index | CodebaseIndexer, GraphStore, StaticAnalyzer, GraphObserver | Index-gated tools promoted after /index |
| Memory | VectorStore (now honest lexical) | Rewritten + tested this session |
| Governor / budget / diff-approval / blast-gate | Governor, budget.veto | Wired through tool.factory |
| Evolution commands | /swarm→SwarmOrchestrator, /council→CouncilOrchestrator, /evolve→GenomeEvolver | Commands delegate to real orchestrators (council shell-injection fixed) |

---

## ❌ DEAD / UNWIRED (registered or present but never reached)

| Item | Evidence | Recommended action |
|---|---|---|
| **`actions/` subsystem** — `action.router.ts`, `executor.graph.ts`, `executor.cron.ts`, `executor.trigger.ts`, `executor.webhook.ts` | `actions/index` imported by **nobody**; no command/protocol wires any executor; `ActionRouter` **never instantiated** | DELETE (or, if you want scheduled/triggered/webhook actions, WIRE them to commands — but that's a new feature, not a fix) |
| **`worker.agent.ts`** | `new WorkerAgent` appears nowhere; only the dead action.router references it | DELETE (sub-agents use SubAgentManager instead) |
| `executor.graph.ts` (logging facade) | only used by dead action.router | DELETE with the subsystem |

These are the "automated action" feature (cron/webhook/trigger executors routed by ActionRouter) that was scaffolded but never connected to any UI. ~5–6 files.

---

## ⚠️ NEEDS PER-ITEM VERIFICATION (instantiated but user-facing wiring unconfirmed)

| Item | Status | What to check |
|---|---|---|
| `ArchitectureGuardian` | `new` in container | Is it consulted on a real path, or instantiated-and-ignored? |
| `TaskPipeline` | `new` in container | Same — does any command/loop drive it? |
| `SemanticAugmenter` | `new` in container | Audit said O(N) LLM calls; is it gated/used by /index-ai? |
| MCP (`/mcp`, McpManageTool) | container connects | Verify a real MCP server connects end-to-end |
| LSP (`/lint`?, LspQueryTool) | container | Verify an LSP server actually starts + returns diagnostics |
| The 62 commands | all reach engine (per TUI-fix-list) | Spot-check the "advanced" ones (/replay, /speculate, /heal, /orchestrate, /watch, /recipe) for real handlers vs thin stubs |

---

## Proposed fix order (lowest risk first)

1. **Delete the dead `actions/` tree + `worker.agent`** (confirmed dead, ~6 files) — pure cleanup, zero behavior change. *(Mirrors Phase 4.)*
2. **Verify + label the 3 "instantiated but unused?" subsystems** (ArchitectureGuardian, TaskPipeline, SemanticAugmenter) — wire if intended, delete if ghost.
3. **End-to-end smoke each integration** (MCP, LSP) with a real server; fix what's broken.
4. **Spot-check the advanced commands**; fix any thin stubs.

Each step = its own commit, tests green between.
