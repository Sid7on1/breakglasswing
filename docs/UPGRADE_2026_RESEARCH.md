# 2026 Agentic-Coding Upgrade — Research, Verdicts, PR Plan

Phase 1–3 output (2026-07-06). Sources: Anthropic 2026 Agentic Coding Trends Report
(resources.anthropic.com/2026-agentic-coding-trends-report), bradAGI/awesome-cli-coding-agents,
hands-on inspection of five cloned repos in ~/Desktop/bimax-research/.

## Phase 1 — Patterns with production evidence

| Pattern | Production evidence | BiMax gap |
|---|---|---|
| Context engineering as the load-bearing skill (curated, ranked context beats raw dumps) | Anthropic 2026 report: 55% faster / 40% fewer errors for teams that master it; Rakuten 24d→5d | Graph context packs are single-repo only |
| Long-running autonomous sessions (hours, not minutes) | Report: 12.5M-line codebase changed in one 7-hour run (Claude Code dynamic workflows) | Round/continue/budget caps were interactive-scale — fixed 2026-07-06 (BIMAX_MAX_ITERATIONS etc.) |
| Cross-directory / multi-repo working sets | Claude Code `--add-dir` additional working directories; Plandex multi-repo planning (2M ctx); Sourcegraph-style cross-repo context | No workspace concept at all — Phase 4 builds it |
| Principled memory retention (spaced repetition, not append-forever) | Vestige: FSRS-6 scheduler over SQLite, shipped MCP server | Assertion store has Beta lifecycle but no decay/forgetting schedule |
| Human-auditable plain-markdown memory | pi-mem (pi agent's production memory; OpenClaw-inspired layout) | BiMax memory is SQLite/graph — user can't read or edit it |
| Deep LSP tool surface | agent-lsp: 50+ LSP tools incl. speculative execution, Docker-ready MCP server | LspQueryTool covers a fraction of LSP |

Rejected at Phase 1 (demo-only / no production evidence): agent-of-empires, Loki Mode, Aeon
(GitHub-Actions loop overlaps our /beast + evolution worktrees), claude-flow (swarm marketing,
we have SpawnSubagentTool + blackboard), brood-box/AgentTier (microVM/K8s sandboxes — server-side
infra, wrong platform for a laptop CLI).

## Phase 2 — Clone verdicts (~/Desktop/bimax-research/)

- **aider** (Aider-AI/aider) — **adapt-pattern-only.** `aider/repomap.py` (867 lines): tree-sitter
  tags → NetworkX PageRank with per-file personalization → token-budgeted ranked repo map. The
  ranking idea is exactly what cross-repo context packing needs (which symbols from repo B matter
  for the task in repo A). Python/NetworkX impl doesn't transplant into our TS engine; our graph
  store already has nodes+edges, so we adapt the ranking, not the code.
- **vestige** (samvallad33/vestige) — **adapt-pattern-only.** FSRS-6 lives in
  `crates/vestige-core/src/fsrs/algorithm.rs`; clean, but adopting the crate means a second memory
  daemon (Rust MCP) beside codemem — duplicate infrastructure. Adapt: apply FSRS-style
  retrievability decay to assertion-store recall priority (stability grows on confirmation,
  retrievability decays with time since last use).
- **pi-mem** (jo-inc/pi-mem) — **adapt-pattern-only.** 1.3k lines TS, zero deps, production use in
  pi. Layout worth stealing: `MEMORY.md` (curated) + `daily/YYYY-MM-DD.md` (append-only, today +
  yesterday preloaded at session start) + `notes/*.md`. Adopting the package wholesale buys us the
  pi plugin surface we don't have; the layout + preload rule is 100 lines in our engine.
- **agent-lsp** (blackwell-systems/agent-lsp) — **adopt-as-is (via MCP).** It IS an MCP server;
  BiMax already self-installs MCP servers by intent (catalog.ts + McpManageTool). Add it to the
  catalog → one-command adoption, zero maintenance. Embedding its Go code would be pointless.
- **opencode** (anomalyco/opencode) — **reject-with-reason.** Their TUI moved to a custom
  TS/bun renderer; adopting it means abandoning our Go/Bubble Tea investment for no capability
  gain. Kept cloned purely as a UX reference (session sharing, provider-status surfaces).

## Phase 3 — Staged PRs (self-sequenced)

1. **PR1 — Workspace core (engine).** Workspace manifest (`.bimax/workspace.json`: path, branch,
   purpose, lastSynced, scope), session-start refresh, clone detection after shell/git tools,
   ask-once registration, per-repo edit scoping (registered-but-read-only by default; primary repo
   + explicitly unlocked repos writable). Pattern source: Claude Code `--add-dir`, Plandex.
2. **PR2 — Workspace surfacing (TUI + tools).** `WorkspaceTool` (list/register/ignore/scope) +
   `/workspace` command; `ui_snapshot.workspace {count, names, scopes}`; status-bar repo chip.
   Pattern source: vibe-kanban's always-visible working-set, Claude Code dir list in /status.
3. **PR3 — Cross-repo context packing.** Index registered repos into the graph store under a
   per-repo namespace; rank cross-repo context aider-style (PageRank personalization seeded by the
   task's mentioned files/symbols); GraphContext accepts `repo:` qualifiers. Pattern source:
   aider repomap.py.
4. **PR4 — Memory upgrades.** FSRS-lite decay on assertion recall (vestige) + plain-markdown daily
   journal with today+yesterday session preload (pi-mem), mirrored from the event ledger so it
   costs nothing to maintain.
5. **PR5 — LSP depth.** Add agent-lsp to the MCP catalog with intent keywords ("rename symbol",
   "find implementations", "call hierarchy") so the agent self-installs it when a task wants
   real LSP. Pattern source: agent-lsp.

PR1+PR2 land together in this session (Phase 4 of the directive); PR3–PR5 are follow-ups.
