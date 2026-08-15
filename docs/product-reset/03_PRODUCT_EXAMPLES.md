# Product examples and what Bimax should learn

These are reference patterns, not cloning targets. The goal is to identify why an interaction is
clear, then express it in Bimax's own product.

## Terminal references

### Claude Code: one command, resumable sessions, machine-readable mode

The official CLI exposes a small entry surface: interactive mode, one-shot print mode, continue,
resume, explicit tool allow/deny lists, and JSON/stream-JSON output. Bimax Terminal should offer the
same clarity: start, continue, resume, inspect, and automate without requiring users to understand
its internal minds, drivers, or protocol.

Borrow:

- a simple default command and obvious resume path;
- structured output as a supported product API, not scraped ANSI text;
- explicit permission modes suitable for shell use.

Do not copy: hiding Bimax's stronger task/evidence/checkpoint model just to look minimal.

Source: [Anthropic: Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)

### Cursor CLI: review is a first-class keyboard workflow

Cursor documents file-by-file review, context selection, resume, command approval, and structured
non-interactive output. Bimax already has most underlying data. Terminal should make “what changed,
what passed, what needs me” the final task surface instead of adding persistent status widgets.

Source: [Cursor: Using the CLI](https://docs.cursor.com/en/cli/using)

### Warp: commands and output become reusable blocks

Warp groups each command and its output into an atomic block, then lets users attach that block as
agent context. Its newer agent workflow keeps interactive terminal state and explicit handoff between
user and agent visible.

Borrow:

- treat command + output + exit state as one evidence object;
- let the user attach a failed block to the next request without copy/paste;
- make agent/user terminal control explicit.

Do not copy: turning Bimax Terminal into a new terminal emulator. It should run inside the terminal
the user already chose.

Sources:

- [Warp: Blocks](https://docs.warp.dev/terminal/blocks)
- [Warp: Full Terminal Use](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use)
- [Warp: Blocks as context](https://docs.warp.dev/agent-platform/local-agents/agent-context/blocks-as-context)

## Desktop references

### Codex app: tasks, projects, diffs, and parallel agents

OpenAI describes the app as a command center: agents run in separate project threads, changes are
reviewed inside the thread, worktrees isolate parallel work, and long-running tasks can continue
without touching the user's current checkout.

Borrow:

- task threads as the primary navigation object;
- inline diff review and direct handoff to an editor;
- background coding tasks separated by project/worktree.

Do not copy: make every internal capability a permanent sidebar destination. Bimax needs a simpler
task canvas plus contextual evidence.

Source: [OpenAI: Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

### Zed: a visual host can consume an external agent process

Zed explicitly separates a native agent, external ACP agent processes, and terminal-backed threads.
This is direct precedent for Bimax Desktop consuming the Terminal engine as a versioned process
instead of copying the engine source into the app repository.

Borrow:

- the host owns the visual thread/review surface;
- the agent process owns auth/model/tool execution behind a defined protocol;
- the user can understand which harness is running.

Sources:

- [Zed: Agents](https://zed.dev/docs/ai/agents)
- [Zed: Zed Agent](https://zed.dev/docs/ai/zed-agent.html)

### Raycast: narrow tools, contextual permissions, and visible calls

Raycast's AI Extensions are focused tools selected by the agent; the UI displays calls and defaults
to approval. Individual tools can be allowlisted and revoked later. Its Quick Fix requests
Accessibility the first time the user invokes the feature.

Borrow:

- approve a named capability/action, not a mysterious global “computer access” switch;
- show action calls in human language with a diagnostic disclosure;
- keep an always-allowed list visible and revocable;
- ask for Accessibility when a user starts a CU task, not when they only want to code.

Sources:

- [Raycast: AI Extensions](https://manual.raycast.com/ai/ai-extensions)
- [Raycast: AI Commands and Accessibility](https://manual.raycast.com/ai/ai-commands)

### Ghostty: native shell around a separable core

Ghostty documents a native macOS GUI consuming a shared core library. Bimax should use the same
ownership principle without copying the implementation choice: Mac-native services and system
behavior surround a reusable engine core.

Source: [Ghostty: About and architecture](https://ghostty.org/docs/about)

## Bimax's combined product pattern

The unique opportunity is not “another Cursor.” A Bimax task has two possible evidence lanes:

- **Code lane:** commands, files, diff, tests, checkpoints.
- **Mac lane:** target app/window, observations, actions, postconditions, permission/focus state.

Both lanes use the same task thread, composer, plan, approvals, and final receipt. The right inspector
changes with the lane. Users should never have to know whether an action used AX, a physical click,
or OCR unless they open Diagnostics.

