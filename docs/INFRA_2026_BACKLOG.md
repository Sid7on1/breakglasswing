# BiMax Infrastructure Backlog — 2026 Full-Stack Hardening Pass

> **Superseded for tracking by [`ROADMAP.md`](./ROADMAP.md)** (2026-07-11). Kept for the 2026
> research baseline and per-mechanism detail. Note: Phases 1–3 shipped; Phase 4 #9 (Terminal-Bench
> adapter) is now **built** (`benchmarks/terminal_bench_adapter/`) — only the leaderboard run
> remains. Open items (#9b/#10/#11) are tracked in the roadmap.

Research-first infrastructure audit (2026-07-05), benchmarked against Claude Code, Codex CLI,
Gemini CLI, Cursor 2.x, and OpenHands. Every gap cites the comparable shipped mechanism.
Phases 1–2 are **shipped** (this pass); Phase 3 is the open backlog.

## Research baseline (July 2026)

- **Terminal-Bench 2.1**: frontier models still fail 18–35% of the 89 tasks; harness design moves
  the same model by up to 13.7 points (GPT-5.3-Codex: 64.7% Terminus 2 → 78.4% SageAgent).
  Self-Harness (June 2026) lifts pass rates 40.5%→61.9% by letting the agent tune its own harness.
  https://www.tbench.ai/leaderboard/terminal-bench/2.0 · https://codex.danielvaughan.com/2026/06/11/terminal-bench-2-1-june-2026-benchmark-landscape-codex-cli-harness-engineering-model-scores/
- **SWE-bench Verified** (July 2026): Claude Mythos 5 95.5%, Fable 5 95%, Opus 4.8 88.6%. https://llm-stats.com/benchmarks/swe-bench-verified
- **Claude Code 2026**: 3-level nested sub-agents, background-by-default agents with worktree
  draft-PR finish, `fallbackModel` chains, agent-tree checkpointing. https://code.claude.com/docs/en/whats-new
- **Codex CLI**: Rust core, kernel-level sandboxing (Seatbelt / Landlock+seccomp), ToolRouter
  approval+sandbox selection before any process spawn. https://developers.openai.com/codex/cli
- **Gemini CLI** (pre-Antigravity): event-driven tool scheduler, parallel extension loading,
  native OTel telemetry; transitioned to Antigravity CLI June 18 2026. https://geminicli.com/docs/changelogs/
- **Cursor 2.0/3**: up to 8 parallel agents in git-worktree isolation; Composer RL model at
  250 tok/s. https://cursor.com/blog/2-0
- **OpenHands SDK**: 72% SWE-bench Verified (Sonnet 4.5 + extended thinking); controller/sandbox
  split over sockets; REST headless mode. https://arxiv.org/abs/2511.03690
- **OTel GenAI semconv**: `gen_ai.*` span attributes are the 2026 vendor-neutral standard
  (Datadog/Honeycomb/New Relic ingest natively). https://opentelemetry.io/blog/2026/genai-observability/
- **MCP 2026-07-28 RC**: stateless core, Tasks extension (long-running work), MCP Apps,
  OAuth/OIDC alignment. https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

## Phase 1 — Observability + Reliability ✅ SHIPPED 2026-07-05

1. **OTel GenAI trace layer** (`src/telemetry/trace.ts`) — closed the gap vs Gemini CLI's native
   OTel. Zero-dependency spans following the GenAI semconv (`invoke_agent` → `chat {model}` →
   `execute_tool {tool}`, plus sub-agent lifetime spans), with `gen_ai.usage.*` tokens, finish
   reasons, typed-outcome error classes, and **epistemic-ledger claim confidence**
   (`bimax.claim.confidence`) on the tool span that opened the claim. Exports: JSONL to
   `.bimax/traces/YYYY-MM-DD.jsonl` (always) + OTLP/HTTP JSON to
   `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces` (batched 64/5s). `/trace` shows recent spans.
   `BIMAX_TRACE=0` disables. Tests: `src/__tests__/trace.test.ts`.
2. **Model fallback chain** (`agent.loop.ts` + `fallbackModel` config / `BIMAX_FALLBACK_MODEL`) —
   the Claude Code `fallbackModel` analogue. When the active model exhausts the transient retry
   budget or is hard-rejected mid-run, the session fails over once to the configured fallback,
   restores the retry budget, and re-asks the same turn. Keeps day-long autonomous runs alive
   through provider outages. Tests: `src/__tests__/agent.loop.fallback.test.ts`.

## Phase 2 — Scalability ✅ SHIPPED 2026-07-05

3. **Worktree isolation for sub-agents** (`src/core/worktree.manager.ts`, `SubAgentConfig.isolation`,
   `SpawnSubagentTool.isolation:"worktree"`) — the Cursor 2.0 / Claude Code pattern. Each isolated
   sub-agent gets its own checkout + branch under `.bimax/worktrees/<id>`; parallel editors can no
   longer clobber each other. Auto-removed (worktree + branch) when the agent changed nothing;
   kept and reported (path + branch in the result) when it did. Floored episodes are re-floored
   to the worktree. Distinct from `evolution/worktree.manager.ts` (swarm waves) by design — see
   module docstring. Tests: `src/__tests__/worktree.isolation.test.ts`.

## Phase 3 ✅ SHIPPED 2026-07-05 (same-day follow-up pass)

4. **MCP Tasks extension** (`src/mcp/tasks.ts` + wiring in `client.ts`) — a task-shaped
   tools/call response (spec 2025-11-25 / 2026-07-28 RC: `result.task.taskId`, plus the `_meta`
   fallback) is polled via `tasks/get` (500ms → 5s backoff, status lines to the footer) and its
   `tasks/result` substituted in, all within the call's timeout budget — long-running server-side
   work behaves like an ordinary slower tool call. `input_required`/`failed`/`cancelled`/timeout
   all surface as normal tool errors. Tests: `src/__tests__/mcp.tasks.test.ts`.
5. **Nested sub-agents, depth ≤ 3** (`SubAgentConfig.depth`, `MAX_SUBAGENT_DEPTH`) — workers with
   depth budget register `SpawnSubagentTool` themselves (thread-local `BIMAX_SUBAGENT_DEPTH`);
   the tool tags children depth+1 and refuses at the cap, so trees are main → worker → nested
   worker and never deeper. Floored episodes don't nest. Tests: `subagent.nesting.test.ts`.
6. **OTLP metrics export** (`src/telemetry/metrics.export.ts`) — per-tool call counts and
   avg/p95 latency, cache-hit rate, prompt tokens, and Headroom savings exported as OTLP/HTTP
   gauges to `{endpoint}/v1/metrics` every 60s (no-op without an endpoint; wired at boot in
   `container.ts`). Tests: `metrics.export.test.ts`.
7. **Harness self-tuning loop** (`src/mind/harness.tuner.ts`, `/harness`) — the Self-Harness
   pattern: recurring failure signatures (tool × errorClass, ≥4 in the last 500 ledger events)
   become steering patches injected into the system prompt (`sections.harnessPatches`), each
   carrying baseline-vs-since failure accounting; patches that don't beat their baseline after
   10 samples auto-retire and are never re-created for that signature. Mined once per episode
   boundary. Tests: `harness.tuner.test.ts`.
8. **Agent-tree checkpointing** (`src/core/agent.checkpoint.ts`, `/subagents resume`) — every
   board change snapshots each live agent's claim + full spawn config to
   `.bimax/agent-tree.json` (atomic rename). On boot, a checkpoint owned by a dead pid surfaces
   its still-running agents; `/subagents resume` respawns them with a crash-context prompt
   including prior tool-call progress. Timed-out/exit≠0 workers now settle the board too (they
   used to linger as 'running'). Tests: `agent.checkpoint.test.ts`.

## Phase 4 — Next open items

9. **Terminal-Bench harness adapter** (impact: high — the leaderboard entry itself) — package
   BiMax headless (`bimax -p`) as a tbench agent adapter (install script + agent class per
   https://www.tbench.ai docs), run the 89-task suite locally in Docker, iterate with /harness
   patches informed by failures. This is the concrete path to putting BiMax ON the leaderboard.
10. **A/B replay validation for harness patches** — today a patch's effectiveness is judged on
    live traffic; wire `replay.harness.ts` so a proposed patch is first validated against
    recorded episodes (offline), Self-Harness style.
11. **OTLP logs export** — ship the ledger's structured events as OTLP logs so traces, metrics,
    and the epistemic ledger correlate in one backend.
