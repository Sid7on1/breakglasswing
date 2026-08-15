# Method and scope

## Competitor set

### Primary product competitors

1. **Hermes Agent** — breadth, provider routing, persistent memory, tools, automation, messaging,
   and a shared core across CLI/TUI/Desktop.
2. **ChatGPT desktop + Work** — integrated desktop projects, files, browser, plugins, long-running
   work, and local Computer Use.
3. **Codex** — focused local coding loop, review, worktrees, subagents, goals, automation, and a
   typed app-server boundary.
4. **OpenCode** — open-source, provider-neutral coding agent with terminal, desktop, IDE, client/
   server architecture, skills, agents, permissions, MCP, and LSP.

### Coding workflow bar

- **Claude Code** — terminal usability, permissions, checkpoints, hooks, skills, background
  subagents, worktrees, and agent teams.
- **Cursor** — editor-native review, checkpoints, background cloud agents, takeover, web/mobile
  handoff, and structured CLI automation.
- **Zed** — parallel agent threads, worktree lifecycle, native/external/terminal agent separation,
  and ACP interoperability.

### Interaction references, not full product targets

- **Raycast** — contextual permissions and narrow, named actions.
- **Warp** — command/output blocks as reusable evidence without treating raw terminal text as an
  unstructured wall.
- **MacOS-Use** — local implementation reference for macOS Accessibility behavior, not a product
  competitor.

## Evidence order

Claims use this order:

1. current first-party product documentation;
2. current first-party open-source repository and its local checkout;
3. Bimax's preserved test artifacts and source;
4. third-party reporting only when no primary source exists, clearly labeled.

Search snippets, old launch posts, community comments, and a single interactive demo are discovery
inputs, not proof. Product versions change quickly, so every published comparison needs a date and
must be refreshed before use outside this repo.

## How comparisons remain fair

- Compare the same task definition, fixture version, machine class, initial state, and grader.
- Use the same model when two products support it. When they do not, publish a separate
  product-native run; never mix it into the same-model score.
- Record provider outages and missing observations as invalid runs, not model failures or passes.
- Grade final state. A tool call, a click, a changed file, or confident prose is not completion.
- Keep raw events, stdout/stderr, screenshots, config hashes, elapsed time, and intervention count.
- Break the grader deliberately. If the test still passes, the grader is not allowed to score runs.
- Report all attempts, discarded runs, and discard reasons.

## Three strategies considered

### A. Copy Hermes breadth

Build messaging channels, voice, image generation, many memory providers, profiles, skins, cron,
browser backends, and plugins immediately.

Rejected as the first strategy. Hermes is already far ahead on breadth, and duplicating it would
preserve Bimax's current problem: too many surfaces before one user journey feels dependable.

### B. Become another coding terminal

Polish the existing TUI, match Claude Code/OpenCode commands, and postpone the Mac app.

Rejected as the product strategy. Bimax would enter the most crowded part of the market with no
durable reason to switch. Terminal remains a serious product, but it is the engine and fast coding
surface, not the entire company wedge.

### C. Own verified Mac building

Match the essential coding workflow, then make one task cross code, browser, and native Mac apps
with clear permissions, background/foreground truth, and fresh proof.

Selected. It uses Bimax's existing coding engine and native computer-use investment, gives Desktop
a reason to exist, and creates a product advantage a model provider cannot erase with one model
release.

## What “better regardless of model” can honestly mean

It cannot mean a weak model will reason as well as the best model on every open-ended task. No
harness can promise that. It means:

- core workflows do not depend on proprietary model-only tools;
- every supported provider passes a capability/conformance check before selection;
- bounded work uses structured plans, typed tools, deterministic state machines, and independent
  verifiers instead of hoping the model remembers every step;
- text-only models receive an auxiliary vision path rather than silently losing screenshots;
- retries change the state or strategy and never repeat the same failed call indefinitely;
- a product feature is not called ready if it works only on the frontier model tier;
- users can switch or fail over providers without corrupting the task, configuration, or evidence.

## Research maintenance

Refresh this pack monthly during active development and before any competitive claim. For every
refresh:

1. check the official source's current product name and availability;
2. update the accessed date and material changes in `08_SOURCE_LEDGER.md`;
3. rerun the relevant head-to-head journey;
4. change the gap register only when there is code plus evidence;
5. keep removed or renamed competitor features as dated history, never as a current row.
