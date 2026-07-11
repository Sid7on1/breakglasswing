# BiMax Roadmap — single source of truth

> **This is the one forward-looking tracker.** It folds together the four roadmap docs that had
> forked over 2026-07 (`MASTER_REBUILD_PLAN`, `INFRA_2026_BACKLOG`, `UPGRADE_2026_RESEARCH`,
> `APP_FULL_UI_PLAN`). Those docs are kept for their detail and rationale but are **superseded for
> tracking** — when in doubt about *what's next*, this file wins. Last reconciled 2026-07-11
> (consolidation plan Phase 3).

The architecture ruling this roadmap serves: **one brain (engine), N faces (Go TUI flagship,
Electron app, print mode), one wire.** Frontends render; all project mutations route through engine
tools. New feature work checks this file first.

---

## Shipped

Condensed record; the cited doc carries the full detail.

| Area | Status | Detail in |
|---|---|---|
| **WS1 — Key management** (provider-aware pool, rotation, 429 cooldowns, model↔provider validation, capability-driven request shaping, `/keys` pool health) | ✅ done | `MASTER_REBUILD_PLAN.md` WS1, `KEY_MANAGEMENT.md` |
| **WS2.1 — Sub-agent lifecycle journal** (timestamped spawn→first-token→tool-call→done; instrument-first) | ✅ done (commit `6940d439`) | `MASTER_REBUILD_PLAN.md` WS2 |
| **WS3 — TUI redesign, phase A** (progressive block-streaming, fixed-slot tool cards, Graphite & Phosphor identity, emoji-glyph retirement) | ✅ done | `MASTER_REBUILD_PLAN.md` WS3, `BiMax Identity` memory |
| **WS4 — Context infrastructure** (3-tier prompt-cache split, single context-budget source, `/context` observability, compaction hygiene) | ✅ done | `MASTER_REBUILD_PLAN.md` WS4, `Context Architecture` memory |
| **INFRA Phase 1–3** (OTel GenAI trace layer, `fallbackModel` chain, sub-agent worktree isolation, MCP Tasks extension, nested sub-agents ≤3, OTLP metrics, harness self-tuning, agent-tree checkpointing) | ✅ shipped | `INFRA_2026_BACKLOG.md` P1–3 |
| **INFRA Phase 4 #9 — Terminal-Bench harness adapter** (packaged: `benchmarks/terminal_bench_adapter/` — agent class, Harbor wiring, setup + build scripts) | ✅ built; leaderboard entry pending | `INFRA_2026_BACKLOG.md` P4 |
| **UPGRADE PR1+PR2 — Multi-repo workspace** (manifest, clone detection, per-repo edit scoping, `/workspace`, TUI ⌂ chip, `ui_snapshot.workspace`) | ✅ done (2026-07-06) | `UPGRADE_2026_RESEARCH.md` PR1–2 |
| **Desktop app — full UI, P0–P6** (3-pane shell, transcript v2, composer v2, Review/Files/Terminal, agent/mind/map panels, sessions+checkpoints, settings) | ✅ shipped (2026-07-10/11) | `APP_FULL_UI_PLAN.md` (now a shipped record) |
| **Protocol v3** + generated app mirror + CI drift gate (consolidation P0–P1) | ✅ done (2026-07-11) | `Consolidation Plan` memory |

---

## Open / Next

Deduplicated across the four source docs, ordered by leverage. Each item cites where its detail lives.

### Product / engine

1. **WS2.2+ — Act on the sub-agent measurements** *(MASTER WS2)*. The journal (WS2.1) now also
   splits **boot overhead (ours) from the model's time-to-first-action** via a `ready` lifecycle
   phase (2026-07-11): `spawn→ready` = key pool + `loadConfig` + graph `loadFromDisk` + ~18 tool
   registrations + persona/system-prompt; `ready→first_event` = model latency (not ours).
   `/subagents timings` reads it (median boot + per-run breakdown). **Next:** run a real swarm,
   read the split, then fix the top measured cost — prime suspects, now measurable: per-worker
   graph `loadFromDisk` and `await loadConfig()` on every spawn (`worker.entry.ts`), and whether
   swarm's per-wave `runWithPool` warms spawns in parallel. Re-measure after each fix.
   *This is consolidation-plan Phase 4's "measured WS2".*
2. **WS5 — Guard audit** *(MASTER WS5)*. **Steps 1–2 DONE 2026-07-11** — enumerated + classified in
   `ARCHITECTURE.md` §4: one ordered pipeline (~13 tool-path checks via `buildTool`→governor + 5
   write-path integrity guards + 3 request-path guards), all load-bearing, none dead. **Remaining
   (step 3):** (a) add **per-guard timing** so a slow guard is visible before it's blamed — the only
   real gap; (b) factor copy-pasted W3+W4 (`detectCorruptWrite`+`shieldEdit`) into one `guardWrite`
   helper; (c) resolve the `TASK_TYPE_MAP` asymmetry for MultiEdit/SymbolEdit; (d) decide whether
   sub-agents should get the `YoloClassifier` (T7) the main session has.
3. **WS6 — Tools audit, full pass** *(MASTER WS6)* — surgical-precision tools shipped (SymbolEdit,
   Edit Shield, RelatedTests); the systematic inventory (schema/description/error/streaming
   quality vs frontier-CLI baseline, fix worst-first) is still open.
4. **WS3 phase B — Design tokens** *(MASTER WS3)* — carry the cinematic pass beyond block-streaming
   into the full token/type/motion system across remaining TUI surfaces.

### Infrastructure

5. **INFRA P4 #9b — Get BiMax onto the Terminal-Bench leaderboard** — the adapter is built; run the
   89-task suite in Docker, iterate with `/harness` patches from failures, submit. *(INFRA P4)*
6. **INFRA P4 #10 — A/B replay validation for harness patches** — validate a proposed patch against
   recorded episodes offline (`replay.harness.ts`) before it hits live traffic. *(INFRA P4)*
7. **INFRA P4 #11 — OTLP logs export** — ship the epistemic ledger's structured events as OTLP logs
   so traces + metrics + ledger correlate in one backend. *(INFRA P4)*

### Context & memory depth

8. **UPGRADE PR3 — Cross-repo context packing** — index registered repos into the graph store under
   per-repo namespaces; rank cross-repo context aider-style (PageRank personalization seeded by the
   task's mentioned files/symbols); `GraphContext` accepts `repo:` qualifiers. *(UPGRADE PR3)*
9. **UPGRADE PR4 — Memory upgrades** — FSRS-lite retrievability decay on assertion recall (vestige
   pattern) + plain-markdown daily journal with today+yesterday preload (pi-mem pattern), mirrored
   from the event ledger. *(UPGRADE PR4)*
10. **UPGRADE PR5 — LSP depth** — add agent-lsp to the MCP catalog with intent keywords ("rename
    symbol", "find implementations", "call hierarchy") so the agent self-installs it on demand.
    *(UPGRADE PR5)*

### Release hardening *(consolidation-plan Phase 5)*

11. **Windows verify** — the NSIS installer is wired but untested; verify a real Windows build.
12. **Code signing** — mac + Windows builds ship unsigned. *(Open founder decision: signing investment.)*
13. **Renderer tests** — the desktop app has typecheck + build in CI but no renderer test suite.

---

## What each source doc is now

| Doc | Role after this merge |
|---|---|
| `ROADMAP.md` (this file) | **Live tracker** — the single source of truth for what's next. |
| `MASTER_REBUILD_PLAN.md` | Reference: the founder directive (verbatim) + the six-problem framing + WS detail. Superseded for tracking. |
| `INFRA_2026_BACKLOG.md` | Reference: the 2026 research baseline + per-phase mechanism detail. Superseded for tracking. |
| `UPGRADE_2026_RESEARCH.md` | Reference: clone verdicts + pattern rationale for PR3–5. Superseded for tracking. |
| `APP_FULL_UI_PLAN.md` | **Shipped record** — the desktop-app spec, all phases delivered. Historical. |

Open founder decisions (do not block engineering, tracked in the consolidation-plan memory):
app direct-write rule, frontend priority (TUI-first assumed), signing investment, workspace layout,
site/benchmarks/jobs split.
