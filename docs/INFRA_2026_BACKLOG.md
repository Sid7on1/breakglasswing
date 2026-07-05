# BiMax Infrastructure Backlog — 2026 Full-Stack Hardening Pass

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

## Phase 3 — Open backlog (ranked by impact/effort)

4. **MCP Tasks extension** (impact: high · effort: high) — adopt the 2026-07-28 RC Tasks
   extension so long-running MCP tools (builds, deploys, indexing) run as durable async tasks
   with polling/deferred results instead of blocking a tool slot. Touchpoint: `src/mcp/manager.ts`
   (self-healing layer already owns per-call lifecycle). Cite: MCP 2026-07-28 RC.
5. **Nested sub-agents, depth ≤ 3** (impact: med-high · effort: med) — Claude Code ships 3-level
   agent trees. BiMax workers don't register `SpawnSubagentTool`, so depth is 1. Add a depth
   counter to `SubAgentConfig`, register the spawn tool in workers when `depth < 3`, cap total
   tree size via the existing blackboard. Combines with worktree isolation (#3) for safe fan-out.
6. **OTLP metrics export** (impact: med · effort: low) — extend `trace.ts` with a `/v1/metrics`
   exporter for the counters that already exist (`globalTelemetry` tool latencies, cache hit
   rate, Headroom savings), so Grafana dashboards get time series, not just spans. Cite: OTel
   GenAI metrics conventions.
7. **Harness self-tuning loop** (impact: high · effort: high) — Self-Harness (June 2026) shows
   the agent mining its own failure patterns into harness patches (prompt steering, tool-schema
   tweaks) for +15-21pt Terminal-Bench gains. BiMax already has the raw material (event ledger,
   episode replay, dream engine); build a `harness.tuner` that proposes and A/B-replays harness
   changes against recorded episodes. Cite: Self-Harness, Terminal-Bench 2.0.
8. **Agent-tree checkpointing** (impact: med · effort: med) — Claude Code checkpoints the whole
   agent tree (progress, intermediate outputs, pending queue). BiMax has episode recording +
   session branches; add periodic sub-agent state snapshots to the blackboard so a crashed
   parent can resume its swarm rather than respawn it.
