# Rival studies

## 1. Hermes Agent — the breadth benchmark

### What is genuinely strong

Hermes runs one agent core across CLI, TUI, Desktop, a web dashboard, an API server, ACP editors,
and many messaging channels. Its official feature overview documents persistent memory, Agent
Skills, checkpoints, cron, subagents, programmatic tool calling, browser automation, MCP, provider
routing/fallbacks, credential pools, plugins, voice, image generation, and external memory
providers. The current Desktop is no longer a thin chat wrapper: it includes projects, files,
artifacts, a persistent terminal, Git review, worktrees, multiple windows/tabs, profiles, and
cross-surface session resume.

The local checkout at `ce6dd1a65f4b6b20b1f3b31f75184a3e26583488` reveals two architectural
ideas worth keeping:

- a **narrow core and expansive edges**: extend existing tools, then skills/commands, gated tools,
  plugins, or MCP before adding a permanent core tool schema;
- **stable conversation prefixes**: system prompt and toolset churn is treated as a cost and cache
  correctness problem, not just an implementation detail.

Its `execute_code` route is also an important harness pattern: a model can compose multiple bounded
tool calls in a sandboxed program and return a smaller structured result, reducing model turns and
large intermediate context.

### Bimax response

- Match: sessions, skills standard, MCP, checkpoints, subagents, worktrees, provider failover,
  structured automation, browser work, and an engine shared across Terminal/Desktop.
- Beat: first-run simplicity, task/evidence hierarchy, native Mac operation, exact action receipts,
  and measured recovery.
- Do not chase now: dozens of messaging channels, skins, voice providers, image generation breadth,
  multiple memory marketplaces, or a management page for every subsystem.

### Opportunity

Hermes's breadth creates configuration and navigation weight. Bimax can feel calmer by keeping the
main window about the current task and placing provider/tool/diagnostic management behind
contextual views. Breadth is a future ecosystem layer, not the launch identity.

Sources: [Hermes feature overview](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/),
[Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop/).

## 2. ChatGPT desktop + Work — the integrated experience benchmark

### What is genuinely strong

OpenAI's current desktop documentation describes one command center for projects, long-running
work, real file outputs, browser work, desktop apps, plugins, scheduled tasks, and notifications.
The user can choose ChatGPT Work or Codex in the same app. Goal mode carries an explicit outcome,
constraints, and verification criteria, with pause/resume/edit controls. The current Computer Use
plugin is app-only, asks for Screen Recording and Accessibility on macOS, stores always-allowed app
choices, supports workflows across apps, and explicitly documents scoped Mac work running in the
background while the user works elsewhere.

This directly explains the behavior observed in the earlier Messages demo: a mature app-owned
service can operate a scoped Mac target without making a terminal executable the permission owner
and without always stealing the foreground.

### Bimax response

- Match: task threads, goals, pause/resume, files/artifacts, browser-first web testing, plugins,
  review, worktrees, and app-only Computer Use.
- Beat: bring-your-own-model/local-model choice, locally inspectable action routing, explicit
  executor/fallback labels, evidence freshness, provider-outage truth, and reproducible public
  evaluation artifacts.
- Do not chase now: a general office suite, a huge plugin marketplace, sites/slides/spreadsheets as
  first-class product categories, or consumer voice/media breadth.

### Opportunity

OpenAI's strength is vertical integration; its weakness for this strategy is model and service
dependence. Bimax can own the local, inspectable alternative—but only if installation, permissions,
updates, and Mac reliability stop feeling like a developer prototype.

Sources: [ChatGPT desktop app](https://learn.chatgpt.com/docs/app),
[Computer Use](https://learn.chatgpt.com/docs/computer-use),
[long-running work](https://learn.chatgpt.com/docs/long-running-work).

## 3. Codex — the focused coding and protocol benchmark

### What is genuinely strong

Codex's CLI keeps the entry surface small: initialize instructions, inspect status, choose
permissions/model, review, edit/run locally, or automate through `codex exec`. The desktop coding
surface adds review scopes, staging/commit/push, worktrees, handoff between local and isolated
checkouts, and parallel task threads. Subagents inherit the parent security boundary and can be
inspected or steered. The open-source `app-server` uses a versioned JSON-RPC boundary for thread,
turn, item, approval, skill, MCP, and compaction events rather than scraping TUI output.

The local checkout at `53d06e24ea318a963812030fa8fed1bd0fc42d42` reinforces important
implementation choices: OS sandboxing, typed approvals before execution, append-only model context,
bounded context fragments, resumable/forkable threads, and generated client schemas.

### Bimax response

- Match: focused Terminal loop, structured headless mode, typed app protocol, review, goal/resume,
  worktree handoff, subagent inspection, permissions, hooks/skills/MCP.
- Beat: provider neutrality, actual native Mac app operation, end-state receipts shared across code
  and Mac lanes, and an evaluator that invalidates provider outages rather than scoring them.
- Do not copy: proprietary native implementations or binaries. Public behavior and open protocol
  patterns are references; licenses and provenance remain binding.

Sources: [Codex CLI](https://learn.chatgpt.com/docs/codex/cli),
[code review](https://learn.chatgpt.com/docs/code-review),
[worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees),
[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## 4. OpenCode — the open harness benchmark

### What is genuinely strong

OpenCode is available as a TUI, desktop app, web/server surface, and IDE extension. Its official
provider page documents 75+ providers plus local models. It has primary agents and subagents,
pattern-based permissions for files/commands/tools/skills/MCP, Agent Skills, MCP, LSP integration,
session sharing, and a headless OpenAPI server. The TUI is itself a client of that server, which
makes multiple clients and SDK generation natural rather than an afterthought.

### Bimax response

- Match: a real client/server seam, custom OpenAI-compatible providers, the major hosted providers,
  local models, Agent Skills, MCP, typed permissions, TUI/Desktop parity, and automation-safe output.
- Beat: model conformance tests, exact verification, native Mac execution, crash-safe task ledger,
  and app distribution quality.
- Do not chase: the provider-count headline before the top providers are tested. “75 configured” is
  less useful than six providers that all pass tool, vision, streaming, compaction, and retry
  contracts.

### Opportunity

OpenCode makes provider freedom table stakes. Bimax's old “provider agnostic” claim is no longer a
unique advantage by itself. The differentiator must be provider **reliability and normalized proof**,
not just a dropdown.

Sources: [OpenCode introduction](https://opencode.ai/docs/),
[providers](https://opencode.ai/docs/providers/),
[agents](https://opencode.ai/docs/agents/),
[server](https://opencode.ai/docs/server/).

## 5. Claude Code — the terminal quality benchmark

### What is genuinely strong

Claude Code supports interactive, resumable, and structured non-interactive flows; granular
allowed/denied tools; plan and permission modes; checkpoints; hooks; MCP; skills; specialized
subagents; background execution; persistent subagent memory; worktree isolation; and coordinated
agent teams. Its current subagent configuration can separately control tools, model, permissions,
MCP, hooks, maximum turns, skills, effort, background behavior, and worktree isolation.

### Bimax response

- Match the clarity of start/resume/print/review and the maturity of checkpoints, hooks, permission
  scopes, and isolated agent work.
- Beat through model/provider choice, one Terminal/Desktop task ledger, native Mac verification,
  and model-tier conformance gates.
- Avoid exposing every Bimax internal persona as a user-facing mode. Users ask for outcomes, not an
  org chart.

Sources: [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage),
[subagents](https://code.claude.com/docs/en/sub-agents),
[checkpointing](https://code.claude.com/docs/en/checkpointing),
[agent teams](https://code.claude.com/docs/en/agent-teams).

## 6. Cursor — the review and remote-agent benchmark

### What is genuinely strong

Cursor combines editor-native context/review with resumable CLI and JSON/stream-JSON automation.
Its background agents run asynchronously in isolated remote machines, can be followed up or taken
over, and hand work back through branches/PRs. Web and mobile surfaces can launch work and return it
to the desktop editor. Local checkpoints provide a low-friction undo path for agent changes.

### Bimax response

- Match: immediate diff review, checkpoints, isolated background work, follow-up/steering, structured
  CLI output, and completion notifications.
- Beat: do not require adopting a new editor; connect the Terminal and Mac app to whichever editor
  the user already uses. Add real local Mac testing and evidence instead of only cloud-browser
  artifacts.
- Keep cloud execution later. First make local crash recovery and worktree handoff excellent.

Sources: [Cursor CLI](https://docs.cursor.com/en/cli/using),
[background agents](https://docs.cursor.com/background-agent),
[web and mobile](https://docs.cursor.com/en/background-agent/web-and-mobile),
[checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints).

## 7. Zed — the interoperability benchmark

### What is genuinely strong

Zed distinguishes its native agent, ACP external-agent processes, and terminal-backed agent threads.
The visual host owns thread organization, editor context, and review; an external agent owns its
runtime, auth, model, tools, and native configuration. Parallel threads can use different agents and
isolated worktrees, and existing external-agent threads can be imported.

### Bimax response

- Publish a stable protocol and add ACP compatibility after the Terminal/Desktop split.
- Let Bimax run inside capable hosts without forcing those hosts to reimplement its agent loop.
- Keep Desktop's native Mac capability as a Bimax-specific extension rather than corrupting the
  generic coding protocol.

Sources: [Zed agents](https://zed.dev/docs/ai/agents),
[external agents](https://zed.dev/docs/ai/external-agents),
[parallel agents](https://zed.dev/docs/ai/parallel-agents),
[ACP](https://zed.dev/acp).

## Product principle extracted from all rivals

The winning architecture is a narrow, versioned agent waist with capabilities at the edges. The
winning experience is the opposite of an architecture diagram: one task, clear progress, contextual
evidence, and a truthful final receipt.
