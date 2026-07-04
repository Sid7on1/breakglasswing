# BiMax — Capabilities & Feature Guide

BiMax is an autonomous coding agent that lives in your terminal. It chats, writes and
runs code with real tools, and goes much further than a normal CLI assistant: it can
split a goal across **parallel sub-agents in isolated git worktrees**, **rewrite its own
source under architectural guardrails**, **heal a failing test suite on its own**, answer
questions about your codebase from a **live code graph**, and **rewind your working tree**
like a time machine — all behind a multi-layer safety governor with a hard spend cap.

It is **provider-agnostic** (NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek, Google) and
**reasoning-model native**.

---

## How it works (the engine)

Every turn runs through a streaming **agent loop** (`src/core/agent.loop.ts`):

1. Your message + a persona system prompt + the live tool schemas go to the model.
2. The model streams back text, *thinking* (kept separate from the reply), and **native
   tool calls**.
3. Tools execute — concurrency-safe ones in parallel, destructive ones sequentially —
   each gated by the **Governor**.
4. Results feed back; the loop continues until the task is done.
5. Context that grows too large is **auto-compacted** (older turns summarized) without
   ever splitting a tool-call/result pair.

Robustness baked into the loop:
- **Reasoning-model native** — `<think>` spans and the `reasoning_content` channel are
  filtered out of the visible reply; an optional `reasoning_effort` knob trades depth for
  speed on slow thinking models.
- **Tool-call recovery** — if a model writes a tool call as plain JSON text instead of
  using the API, BiMax recovers it and runs it (gated strictly on real tool names).
- **Output contract + self-correction** — leaked meta-chatter ("No function call is
  needed…") is stripped; a turn that collapses to nothing is regenerated.
- **Self-critic** (optional) — a reviewer pass checks the work and revises if it finds
  defects before you ever see it.

---

## Headline features (the wow factors)

### 🐝 Swarm — parallel multi-agent execution
`/swarm <goal>` decomposes a goal into a dependency graph of sub-tasks, then runs them as
**parallel sub-agents, each in its own isolated git worktree**. Independent tasks run
concurrently in dependency "waves"; results are merged onto an integration branch for you
to review. **Benefit:** big, multi-file changes get done in parallel without ever touching
your working branch. *(Verified end-to-end.)*

### 🔭 Speculate — try several approaches, keep the best
`/speculate <task>` asks the model for several genuinely different strategies, implements
**each one in parallel in its own worktree**, runs your tests against each, and recommends
the winner (passing tests, smallest viable change) — leaving the options on branches.
**Benefit:** for hard problems you get competing, tested solutions instead of one guess.

### 🏛️ Council — make rival AI CLIs compete
`/council <task>` hands the same task to **multiple external AI CLIs** (Claude, Gemini,
opencode, BiMax itself), each in its own worktree, then **judges them by running your test
suite** and keeps the winner's branch. **Benefit:** a model-agnostic "bake-off" — let the
best tool for *this* task win, objectively scored by tests. *(Unique to BiMax.)*

### 🧬 Evolve — the agent improves its own source
`/evolve <Component> <improvement>` lets BiMax modify **its own codebase**, gated by an
**Architecture Guardian** that enforces each component's contract (e.g. the events it must
still emit). Changes happen in a worktree, are type-checked and tested, and are only kept
on a branch if the guardian passes — **never auto-merged**. **Benefit:** safe, self-
improving software with hard architectural guardrails. *(Disabled until you opt in.)*

### 🩺 Heal — self-healing test suite
`/heal` runs your tests; if they're red, a fix agent works in an isolated worktree **until
they're green**, then surfaces the patch on a branch. **Benefit:** "make the build pass"
as a single command, with the diff handed to you for review.

### ⏳ Time Machine — checkpoint & rewind
`/checkpoint` snapshots your working tree; `/rewind` restores any earlier snapshot.
**Benefit:** experiment fearlessly — jump back to any point in seconds.

### 🧠 Code-graph intelligence
BiMax builds a **live graph of your codebase** (AST structure via `/index`, plus optional
AI semantic metadata via `/index-ai`) and keeps it fresh as files change.
- `/ask <question>` — answer architectural questions **from the graph**, not guesswork.
- `/impact <symbol|file>` — **blast-radius preview**: what breaks if you change this.
**Benefit:** the agent (and you) understand structure and risk before editing.

### 💤 Dream & self-evolution skills
Background "skills" run as specialized personas: **DreamSkill** performs *memory
distillation* — compressing long execution logs into dense memory vectors so long-term
context isn't lost; **EvolutionSkill** analyzes the codebase for weak spots to improve
(under the guardian). **Benefit:** the agent gets sharper and remembers more over time.

---

## Persistent, self-writing memory
- **Short-term** working memory + **long-term vector store** for semantic recall.
- **Project memory** (`/remember`, or the agent's own `RememberTool`) stores durable
  conventions, decisions, and gotchas and re-injects the relevant ones into future turns.
- **Auto-compaction** keeps long sessions within the context window without losing the
  thread (and without breaking tool pairings).
**Benefit:** BiMax learns your project's conventions and stops re-asking.

## Multi-layer safety governor
Every risky action passes a layered **Governor** (`src/governor/`):
1. **Bash static analyzer** — classifies command risk (`rm -rf`, `curl | bash` → high).
2. **ML risk classifier** — a learned check for ambiguous cases (auto mode).
3. **Budget veto** — a **hard daily spend cap** (default $5) with reserved/actual
   accounting, persisted per project.
4. **Filesystem veto** — confines edits to the workspace; blocks forbidden paths.

Modes: `interactive` (ask on risk) · `auto` (smart auto-approve) · `strict` (ask always) ·
`plan` (read-only, propose only) · `bypass` (YOLO). Plus **diff approval** to review every
file change before it lands. **Benefit:** autonomy you can actually trust, with a money cap.

## Provider-agnostic + resilient keys
- Works with **NVIDIA NIM, OpenAI, Anthropic, OpenRouter, DeepSeek, Google** out of the box
  (`/provider`, `/model`, `/keys`).
- A **round-robin key pool** with per-key cooldowns and 429/timeout backoff spreads load
  across many keys and survives rate limits; each key can even map to a different model.
**Benefit:** no single-vendor lock-in, no single-key throttling.

## Extensible agents & skills
- Built-in personas: **BiMax** (orchestrator), **Hermes** (fast read/search/exec),
  **OpenCode** (deep coding), **OpenClaw** (OS execution).
- **Dynamic skill personas** defined in simple JSON (`skills/*.json`).
- **`RegisterAgentTool`** — install *any* CLI (`npm i -g`, `brew install`, `curl | bash`)
  and BiMax registers it as a new agent persona on the fly.
- **Routing rules** (`/routes`) send matching prompts to the right specialist agent.
**Benefit:** BiMax grows new abilities without a rebuild.

## A genuinely clean terminal UX
A Go / Bubble Tea TUI running in inline mode (committed lines go to the terminal's native
scrollback; only the live region redraws): streaming markdown, syntax-highlighted code blocks,
live tool-call lines (`⏺`/`⎿`), a command palette, inline diffs, dashboards, multiple
themes, a thinking indicator with a live reasoning tail, ghost-free resize, **session
save/resume** (`/sessions`, `/resume`), **transcript replay** (`/replay`), and live
**cost/usage** tracking (`/cost`).

---

## Why BiMax stands out vs other CLI agents

| Capability | BiMax | Typical CLI agent |
|---|---|---|
| Provider lock-in | **None** — 6 providers, hot-swappable | Usually one vendor |
| Parallel multi-agent work | **Yes** — swarm in isolated worktrees | Rare / single-threaded |
| Multi-CLI "bake-off" judged by tests | **Yes** — `/council` | No |
| Self-evolution with arch. guardrails | **Yes** — `/evolve` + Guardian | No |
| Self-healing test loop | **Yes** — `/heal` | Rare |
| Code graph + blast-radius (`/impact`) | **Yes** | Rare |
| Time-machine checkpoints | **Yes** — `/checkpoint` `/rewind` | Rare |
| Hard $ budget cap + ML risk gate | **Yes** | Usually none |
| Key-pool failover across many keys | **Yes** | No |
| Reasoning-model handling + tool recovery | **Yes** | Varies |
| Worktree isolation (never touches your branch) | **Yes** | Often edits in place |

**The big idea:** most CLI agents are a single model with a few tools. BiMax is an
**orchestration platform** — many agents, many models, real architectural awareness, and
strong safety rails — that does ambitious, parallel, self-correcting work while keeping
your branch and your budget protected.

---

## Command reference (40+ commands)

**Core / chat:** `/help` `/clear` `/context` `/cost` `/config` `/model` `/provider` `/keys`
**Files & code:** `/edit` `/write` `/diff` `/diff-file` `/undo` `/lint` `/check` `/git` `/log`
**Intelligence:** `/index` `/index-ai` `/ask` `/impact`
**Multi-agent:** `/swarm` `/speculate` `/council` `/evolve` `/heal`
**Time machine:** `/checkpoint` `/rewind` `/backups`
**Sessions & memory:** `/sessions` `/resume` `/replay` `/remember`
**Agents & routing:** `/agents` `/skills` `/routes` `/register` (via tool)
**Safety & modes:** `/governor` `/plan` `/diff-approval` `/self-critic` `/agent-decisions`
**Automation:** `/watch` (wake the agent on a file change or schedule)

> Run `/help` inside BiMax for the live, searchable list.
