# Bimax Desktop — Full-Capability UI Plan

**Goal.** The desktop app must surface *everything* Bimax can do — not a chat bubble in front of an
86-command engine. Benchmark: Claude Code desktop / Cursor-class agent shells (three-pane IDE
layout, rich transcript with edit chips, right utility dock with Terminal/Files/Review/Browser,
composer with permission + model selectors, project/session sidebar). Bimax already has MORE
engine capability than those shells expose (mind layer, graph, sub-agent swarms, ledger,
blueprints); the app's job is to make it all visible and one click away.

**Ground rules.**
- The engine stays the single brain: same headless NDJSON protocol (v1) the Go TUI drives.
  UI-only subsystems (file tree, git status, terminal PTY) run Electron-native in the main
  process — they never need the engine, exactly like competitor shells.
- Brand is locked: Graphite & Phosphor — warm terracotta `#D77757` accent on graphite, low
  chrome, **never neon** (overrides the skill's slate/green suggestion; we keep its structural
  guidance: dark-only, systematic type scale, SVG icons, visible focus, minimal glow).
- Every feature listed here already works through the composer as a slash command TODAY; this
  plan decides which get first-class chrome. Nothing regresses to "command-only".

---

## 1. Design system (app-wide)

| Token layer | Decision |
|---|---|
| Palette | Existing Tailwind v4 `@theme`: surfaces `bg/raise/hover/well/line`, ink `ink/dim/faint`, phosphor `ember/ember-bright/ember-deep/moss/amber/rust`. Add `elev-1/2/3` shadow scale + `z-0/10/20/40/100/1000` scale. |
| Typography | UI: Inter (variable, self-hosted — CSP blocks Google Fonts). Code: SF Mono/ui-monospace. Scale: 11 / 12 / 13.5 (base) / 15 / 18 / 24. Tabular numerals for all counters (tokens, lines, costs). |
| Icons | **lucide-react**, 16/20px, stroke 1.75, one style level. Replaces every emoji-as-icon (⌂ 🧠 ◮ ◌ ✓) in chrome. Emoji stay only inside *content* (transcript text). |
| Motion | 150–250ms, ease-out enter / ease-in exit (exit ≈ 65% of enter), transform/opacity only, stagger 30ms for lists, `prefers-reduced-motion` honored. Panels slide from their edge (spatial continuity). |
| A11y | 4.5:1 text contrast on all surfaces (audit `dim`/`faint` on `bg`), 2px ember focus ring everywhere, full keyboard nav, `aria-live=polite` on streaming + status, color never sole signal (icons + text). |
| Density | 4/8px spacing rhythm; three-pane grid; content column max 860px; virtualized lists ≥50 items. |

---

## 2. Information architecture — the three-pane shell

```
┌────────────┬──────────────────────────────────────────┬───────────────┐
│  SIDEBAR   │   TRANSCRIPT (center, max-w 860)         │  DOCK (tabs)  │
│            │                                          │               │
│ New task   │   rich agent stream                      │ Review (git)  │
│ Search ⌘K  │   grouped tool activity                  │ Files         │
│ ────────   │   dashboards / menus                     │ Terminal      │
│ Projects   │                                          │ Agents        │
│  ▸ repo A  │                                          │ Map (graph)   │
│ Sessions   ├──────────────────────────────────────────┤ Mind          │
│  ▸ chat 1  │   COMPOSER                               │ (＋ overflow: │
│  ▸ chat 2  │   [mode][permission][model]  [mic?][↑]   │  MCP, Trace)  │
│ ────────   │                                          │               │
│ user/plan  │                                          │               │
└────────────┴──────────────────────────────────────────┴───────────────┘
                     FOOTER: status · chips (ctx, 🧠→icon, goals, ws)
```

- **Sidebar** (collapsible to icon rail, ⌘B): New task, Search (⌘K opens command palette),
  Projects (workspace manifest + recent folders), Sessions per project (resume/rename/delete),
  bottom: user/settings. Active item highlighted (nav-state-active).
- **Dock** (right, collapsible ⌘J, resizable): tabbed panels, max 6 visible + overflow menu.
  Empty state = "Choose a tab" cards like the competitor's Open-tab screen.
- **Command palette (⌘K)**: fuzzy over all 86 slash commands (registry already serves
  completions over the wire), recent files, sessions, panel jumps. This is how the long tail of
  commands stays discoverable without 86 buttons.
- **Footer**: engine state, ephemeral status (self-clearing ~10s, TUI parity), chips → context
  meter, mind, goals, workspace, model. Chips are BUTTONS that open their panel/popover.

---

## 3. Capability → surface matrix (all 86 commands, none missed)

**Legend:** ▣ dedicated panel/control · ◪ popover/menu rendered from existing engine menu ·
◇ command-palette + transcript dashboard (already works; gets rich rendering)

| Domain | Commands | Surface |
|---|---|---|
| Sessions & history | /sessions /resume /clear /log | ▣ Sidebar sessions list (+ ⌘1..9), /clear = toolbar |
| Time machine | /checkpoint /rewind /undo /backups /timemachine /tx | ▣ "History" strip in Review panel: checkpoint timeline, one-click rewind (confirm dialog) |
| Git | /git /diff /diff-file /branch /autocommit | ▣ **Review panel**: Electron-native status/diff viewer + Changes +N −M pill in header (like competitor), commit box, branch switcher; engine commands drive writes |
| Modes/personas | /mode /agents /council | ▣ Composer **mode selector** (general/explore/sketch/code/beast; Shift+Tab cycles — TUI parity); /council ◪ |
| Models & routing | /model /provider /keys /tier /routes /reasoning /context-window /context-mode /harness | ▣ Composer **model selector** (model · tier · reasoning) + Settings→Models page w/ key-pool health (per-key ok/fail/cooldown); rest ◪ |
| Permissions | /governor /diff-approval /taint /security | ▣ Composer **permission selector** ("Ask before changes / Approve edits / Plan only" → governor modes + diff-approval); /security /taint ◇ |
| Context & memory | /context /remember /goals /exemplars /claims /headroom /map /index /index-ai /impact | ▣ Map panel (graph modules, node counts, index/index-ai actions, impact query); Goals in Agents panel; context meter popover shows /context + headroom savings; others ◇ |
| Mind layer | /self /drives /dream /habits /dogfood /calibration /agent-decisions /arms /episodes /replay /ledger /pipelines | ▣ **Mind panel** = Ctrl+X HUD as a real pane: weak spots w/ posteriors, drive sparklines, habit list, epistemic ledger (resolved/open/expired/coverage), calibration; episodes/replay/dream as sub-tabs; rest ◇ |
| Sub-agents & orchestration | /subagents /swarm /speculate /heal /orchestrate /beast /scout /self-critic /plan /evolve | ▣ **Agents panel**: live sub-agent cards (subagent_update is already on the wire) with status/latest-tool/expand PROMPT-TOOLS-OUTPUT (TUI parity); swarm/beast launchers as buttons w/ arg forms; todos strip lives here too (todo_update) |
| Blueprints | /blueprint /recipe /watch | ◪ Blueprint browser (list .bimax/blueprints, build/verify actions); /watch train monitor ◇ w/ live chart later |
| Tools & infra | /mcp /plugins /skills /trace /perf /diagnostics /cost /output /shortcuts /help /changelog /config /check /lint /edit /write /file /ask /scout | ◪ Settings pages (MCP w/ doctor + per-tool telemetry, Plugins, Skills w/ self-authoring); /trace /perf /diagnostics /cost ◇ dashboards; /help → palette; rest ◇ |
| Workspace | /workspace | ▣ Sidebar Projects section (multi-repo chips, writable badge) |

Everything marked ◇ still gains from Phase-2 transcript work: `HelpDashboard`,
`StatsDashboard`, `DataTableDashboard` uiComponents get real table/stat-tile renderers instead
of plain text, so "command-palette only" commands still look first-class.

---

## 4. Transcript — the center pane spec

1. **Message blocks**: full markdown (headings, lists, tables, quotes) via `marked` + sanitizer
   (React-node renderer, no `dangerouslySetInnerHTML`); syntax-highlighted code fences
   (`highlight.js`, graphite theme) with copy button + language tag; collapsed
   "Thought for N s" expander (thinking text retained, not just tail).
2. **Grouped activity chips** (the competitor's "Edited 2 files · 163 lines"): consecutive
   mutating tool calls (Edit/Write/SymbolEdit) collapse into one chip — `✎ Edited N files · M
   lines` — expand → per-file diff cards; read-only runs (Read/Grep/GraphQuery) collapse into
   `⌕ Explored k files`. Raw per-call cards remain one level deeper.
3. **Tool cards v2**: category icon (lucide), duration, nested sub-agent indent w/ agent label
   chip, error state w/ retry context; file paths + `@symbols` are clickable → Files panel /
   Map panel.
4. **Dashboards**: render the three engine dashboard kinds as stat tiles / data tables
   (respect chart rules: legends, tabular numerals, no color-only meaning).
5. **Menus**: current MenuCard stays (already wired to menuSelect).
6. **Streams**: block-streaming like TUI Phase A — tokens append to a live block; virtualized
   scrollback (react-virtuoso or manual windowing) for day-long autonomous sessions; "jump to
   latest" pill when unpinned.
7. **Session header**: title (first prompt, editable), project + branch pills, elapsed/cost.

## 5. Composer spec

- Left controls: **＋ attach** (files → `@path` insertion), **mode selector**, **permission
  selector**; right: **model selector** (model · tier), context-meter ring, send/interrupt.
- Autocomplete v2: floating panel w/ kind sections (command/symbol/path), keyboard nav,
  disabled-reason rows (index-gated tools show why).
- Multi-line, ⌘Enter force-send, Esc interrupt, ↑ history recall; queued-instruction indicator
  when busy.
- Mic/voice: **out of scope** (no engine support; don't fake it).

## 6. Electron-native subsystems (no engine changes)

| Subsystem | Implementation |
|---|---|
| Files panel | main-process fs watcher + tree (ignore node_modules/.git), read-only viewer w/ highlighting; "reveal in Finder", "insert @path into composer" |
| Review panel | main spawns `git` (status --porcelain=v2, diff, log, branch); word-level diff render (reuse TUI's approach as reference); commit/branch actions run through engine `/git` so ledger/attribution see them |
| Terminal | `node-pty` + `xterm.js` tab(s) in dock, cwd = project; theme = graphite tokens; ⌘T |
| Sessions store | reuse engine history files (BIMAX_HISTORY_PATH dir) for list metadata; open = respawn engine with `/resume <id>` |

## 7. Engine/protocol extensions (small, versioned)

1. `session_list` — machine-readable sessions (id, title, mtime, project) in `ui_snapshot` or
   as a `query` kind; today /sessions renders a human menu only.
2. `ui_snapshot.git` — optional branch + dirty counts so header pills don't need main-process
   polling when engine already knows.
3. `checkpoint_list` — ids + labels for the History strip (drives /rewind).
4. Protocol bump → v2 with graceful degrade (app hides panels when fields absent, shows
   "engine too old" banner — mismatch UX already exists).
Everything else needed is ALREADY on the wire: subagent_update, todo_update, mind detail,
graph summary, menus, dashboards, veto/diff/input requests, completions, ping/pong.

## 8. Phases (each ends green: typecheck + build + screenshot smoke via scripts/screenshot-ui.mjs, extended per panel)

- **P0 — Shell & system** ✅ DONE: 3-pane resizable/collapsible layout, lucide icon pass
  (kill emoji chrome), Inter self-hosted, z/elevation scales, ⌘K palette (engine completions),
  footer chips→popovers, keyboard map (⌘B/⌘J/⌘K/⌘O/⌘T/Shift+Tab), focus-ring + reduced-motion
  audit.
- **P1 — Transcript v2** ✅ DONE: markdown/highlighting, grouped edit/explore chips, tool cards v2,
  dashboard renderers, thought expander, virtualization, session header.
- **P2 — Composer v2** ✅ DONE: mode/permission/model selectors (wired to /mode, governor+
  /diff-approval, /model + tier), attach, autocomplete v2, context ring.
- **P3 — Review + Files + Terminal** ✅ DONE (2026-07-10): main-process git/fs/pty backends
  (src/main/{git,files,pty}.ts), ReviewPanel (status + word-level DiffView + commit box + branch
  switcher; writes via engine `/git commit|checkout` — added engine-side), TitleBar changes pill,
  FilesPanel (lazy tree, hljs viewer, @-insert via bimax:compose-insert, reveal), TerminalPanel
  (@lydell/node-pty N-API prebuilds + @xterm/xterm, module-scoped session survives tab switches),
  electron-builder ships/unpacks @lydell/**. Screenshots: ui-{review,diff,files,terminal}.png.
- **P4 — Agent panels** ✅ DONE (2026-07-10): Agents — expandable sub-agent cards
  (PROMPT/RUN/OUTPUT) + Swarm/Beast launcher forms (`/swarm`, `/beast`); Mind — quick actions
  (/self /dream /episodes) over the live HUD; Map — Build/Re-index + AI-layer actions + /impact
  query input.
- **P5 — Projects & sessions** ✅ DONE (2026-07-10): protocol v2 (`ui_snapshot.sessions` from
  session.meta, `ui_snapshot.checkpoints` + new `timemachine_changed` engine event,
  `ui_snapshot.git`; fixtures regenerated, TUI `supportedProtocol=2`); sidebar sessions list
  (current pinned, click = `/resume <id>`), Review History strip (checkpoint-now + two-step
  red rewind confirm). Rename/delete deferred — engine has no such commands yet.
- **P6 — Settings & long tail** ✅ DONE (2026-07-10): SettingsDialog (gear in sidebar footer) —
  grouped chrome over engine menus (Models/keys/tier/routes/reasoning · MCP/Plugins/Skills/
  Security/Diff-approval · trace/perf/cost/diagnostics/changelog), packaging refresh (DMG
  rebuilt with @lydell/** shipped + asarUnpacked). Deferred: dedicated settings *pages* (menus
  suffice — same source of truth as CLI), deep a11y/perf audit.

## 9. UX guardrails (from ui-ux-pro-max, enforced in review)

No emoji as chrome icons · one primary CTA per surface · visible focus everywhere ·
4.5:1 contrast (test dark independently) · 150–300ms motion, transform/opacity only,
interruptible, reduced-motion · virtualize 50+ lists · skeletons over spinners >300ms ·
errors state cause + recovery · destructive actions red + separated + confirmed (rewind,
delete session) · toasts aria-live, self-dismiss 3–5s · nav placement never changes per page ·
tabular numerals for all metrics · no horizontal scroll; panes scroll internally.
