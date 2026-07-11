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
2. **WS5 — Guard audit** *(MASTER WS5)*. **DONE 2026-07-11.** Steps 1–2: enumerated + classified in
   `ARCHITECTURE.md` §4 (one ordered pipeline, all load-bearing). Step 3: added **per-guard timing**
   (`tools/guard.timing.ts` → `/perf`); **fixed a real permission gap** (SymbolEdit wrote without the
   governor prompt — now mapped to `FILE_WRITE`); documented the sub-agent `YoloClassifier` omission
   as a deliberate cost decision; MultiEdit's `TASK_TYPE_MAP` exclusion now commented. The W3+W4
   `guardWrite` factoring was deferred as low-value (logic already centralized). Nothing left open.
3. **WS6 — Tools audit, full pass** *(MASTER WS6)*. **DONE 2026-07-11** — full 41-tool inventory +
   quality assessment in `ARCHITECTURE.md` §3/§3.1. Verdict: surface is solid (rich schemas +
   descriptions; typed outcomes scoped to attributed mutating tools by design). The one real defect
   (SymbolEdit permission gap) was fixed under WS5 step 3. No worst-first emergencies.
4. **WS3 phase B — Design tokens** *(MASTER WS3)*. **DONE 2026-07-11** — `tui/styles.go` is now the
   single source of truth: added semantic tokens (`colInk`/`colBright`/`colDiffAddBg`/`colDiffDelBg`),
   removed every raw hex from style definitions (incl. two literals that duplicated `colDiffAdd`/
   `colDiffDel`), tokenized `diff.go`, and documented markdown.go's separate chroma syntax palette.
   Go build + `go test ./...` green.

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
9. **UPGRADE PR4 — Memory upgrades**. **DONE 2026-07-11** — FSRS-lite growing-stability decay on
   assertions (`user.model.ts`: half-life grows per restatement, ≥3× durable) + plain-markdown daily
   journal (`mind/daily.journal.ts`) projected from the event ledger, today+yesterday preloaded into
   the system prompt, `/journal` command + `.bimax/journal/*.md` artifacts. Tests green.
10. **UPGRADE PR5 — LSP depth**. **DONE 2026-07-11** — agent-lsp added to the MCP catalog
    (`mcp/catalog.ts`) with intent keywords (rename symbol / find implementations / call hierarchy /
    diagnostics) so the agent self-installs it on demand. *(Verify the exact npm package name on
    first real install — the catalog command is a best-effort `npx -y agent-lsp`.)*

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
