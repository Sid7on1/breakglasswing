# Bimax Desktop Capability Visual System

This is the product map for turning Bimax's engine integrations into visible desktop features. It is deliberately based on live protocol state; no production panel should use decorative or invented metrics.

## Visual direction

**Subject:** a coding-intelligence instrument for developers supervising autonomous work.

**Palette:** Graphite `#161412`, Raised graphite `#1e1b18`, Ink `#e8e2da`, Ember `#d77757`, Moss `#9cb380`, Amber `#d9a05b`. Ember denotes active intelligence, moss means evidenced/healthy, amber means attention, and rust is reserved for actual failure.

**Typography:** Inter Variable for controls and explanations; SF Mono/system monospace for identifiers, counts, runtime facts, and evidence. Type remains compact because this is an instrument panel, not a marketing surface.

**Layout:** the right workspace has three persistent capability lanes. The first row answers “where am I?”, the second chooses a surface inside that lane, and the body gives the feature its own visual grammar.

```text
┌──────────────┬──────────────────────┬─────────────┐
│ Work         │ Intelligence         │ Runtime     │
│ 18 changed   │ 2 active             │ degraded    │
├──────────────┴──────────────────────┴─────────────┤
│ Review   Files   Terminal                         │
├──────────────────────────────────────────────────┤
│ capability-specific visual + evidence + actions  │
└──────────────────────────────────────────────────┘
```

**Signature:** the three-lane signal rail. Each lane exposes one truthful live signal even while another panel is open, so powerful features stay discoverable without an icon-only toolbar or a hidden dropdown.

## Capability map

| Engine capability | Desktop surface | Primary visual | Evidence/state |
|---|---|---|---|
| Review lifecycle and approvals | Work → Review | causal work timeline | approval, edits, verification, checkpoint |
| Native filesystem and editor | Work → Files | project tree/editor handoff | real filesystem entries and open files |
| Project shell | Work → Terminal | persistent terminal canvas | native PTY session |
| Swarm/speculate/heal/beast | Intelligence → Agents | execution lanes and convergence pipeline | sub-agent status, scope, tool count, task state |
| Native AST graph | Intelligence → Map | module constellation | symbol/file count, modules, criticality |
| codebase-memory semantic engine | Intelligence → Map | semantic-online state on the graph field | graph engine identity and readiness |
| Impact analysis and blast gate | Intelligence → Map and Work → Review | affected-module paths and risk tone | graph query results and review risk |
| Self-model weak spots | Intelligence → Mind | cognitive pulse and evidence cards | posterior failure rate, sample count, advice |
| Drives | Intelligence → Mind | health signals with sparklines | measured value, setpoint status, history |
| Habit compiler | Intelligence → Mind | learned routine list | compiled habit names |
| Epistemic ledger | Intelligence → Mind | verification posture | resolved/open/expired/coverage |
| Headroom/native compression | Intelligence → Mind | context-memory gauge | baseline, context window, saved tokens |
| Dream and episode replay | Intelligence → Mind | learning controls and episode history | protocol-backed run/replay state (future native payload) |
| Multi-repo workspace | Intelligence → Map | repository constellation | workspace names and writable count |
| Engine supervisor | Runtime → Health | runtime pulse and startup ladder | phase, heartbeat, RSS, event-loop delay, profile |
| Resource shedding | Runtime → Health | capability status matrix | enabled/deferred capability and reason |
| Crash journal and recovery | Runtime → Health | crash sequence and recovery action | classified exits and redacted log tail |
| Time Machine checkpoints | Work → Review | recovery timeline | checkpoint identity, timestamp, outcome |
| MCP and skill registry | Future Intelligence → Capabilities | connected capability matrix | installed, healthy, degraded, unavailable |

## Delivery sequence

1. **Implemented now:** visible capability lanes; graph field; agent orchestration hero/pipeline; cognitive pulse; context-memory gauge; runtime pulse.
2. **Next protocol slice:** native typed actions/results for impact, dream, episodes, goals, MCP, and skills so these features never use transcript slash commands as an internal UI API.
3. **Next visual slice:** native impact paths, episode timeline, MCP/skill capability matrix, and multi-repo constellation.
4. **Polish:** keyboard shortcuts, narrow-width behavior, reduced-motion review, and packaged-app screenshot review.

The UI should never imply a subsystem is operating when the protocol has no evidence. Empty states explain what unlocks the surface; unavailable integrations show a reason rather than disappearing.

## Native Desktop feature roadmap

These are product surfaces, not slash-command launchers. Each requires a typed protocol or IPC
payload and renders its result locally without adding operational noise to the conversation.

### Work lane

- **Mission timeline:** one causal stream for plan steps, approvals, edits, verification, and
  checkpoints. Selecting a moment focuses the related diff or evidence.
- **Artifact studio:** preview generated documents, diagrams, screenshots, and HTML artifacts in a
  native canvas with version comparison and “attach to task.”
- **Verification lab:** saved build/typecheck/lint recipes, live command progress, concise failures,
  and rerun controls independent from the original mutation.
- **Time Machine:** visual before/after checkpoint rail with changed-file summaries and an explicit
  restore preview.

### Intelligence lane

- **Workspace atlas:** repositories as connected regions, with writable/read-only boundaries and
  cross-repo symbol edges.
- **Impact paths:** a native blast-radius graph from a selected file or symbol; selecting a node
  opens source, callers, tests, and review risk.
- **Agent theater:** parallel work lanes with ownership, dependencies, convergence points, and
  worktree identity—without dumping sub-agent transcripts into the main chat.
- **Episode library:** searchable learning episodes with outcome, tools, cost, verification, and
  replay eligibility.
- **Capability library:** MCP servers, installed skills, native tools, and model abilities in one
  matrix showing online, degraded, permission-blocked, or unavailable.
- **Context inspector:** visual working-set layers—system instructions, tool schemas, conversation,
  retrieved memory, repo map, and compression savings—with safe controls for releasing context.

### Runtime lane

- **Model router:** active/fallback/sub-agent models, key-pool health, latency, and failure routing.
- **Resource governor:** memory/CPU pressure history, capability shedding decisions, and the exact
  reason a service was deferred.
- **Protocol console:** structured inbound/outbound event viewer with secret redaction, filters, and
  export; never raw terminal noise in chat.
- **Crash recovery:** grouped crash sequences, stability windows, safe-profile progression, and
  interrupted-session recovery.
- **Automation desk:** scheduled local tasks and monitors with next-run time, scope, permissions,
  last outcome, and pause/resume controls.

### Desktop-native interaction rules

- Files and symbols support drag-to-composer and Quick Look.
- Every feature has a command-palette action and keyboard route.
- Long operations live in the right workspace and macOS notifications—not modal spinners.
- Native menus expose New task, Open project, Search, Review changes, Runtime Health, and Settings.
- Window restoration remembers project, selected lane, panel widths, open editor tabs, and terminal
  session independently per project.
- No Settings, diagnostics, recovery, graph, skill, or MCP action communicates internally by
  printing a slash command into the transcript.
