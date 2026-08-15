# BiMax

**An autonomous AI coding agent for your terminal — the two-minded machine.**

Most AI CLIs show you one stream of consciousness. BiMax shows you a machine that thinks in
two registers and is accountable for both: a fast intuition and a deep reasoner it routes
between, and an epistemic ledger that verifies what it did and tells you *how sure it is*.

BiMax ships as **one self-contained binary** — a Go / Bubble Tea TUI with the engine baked in.
The machine you run it on needs no Node, no Bun, no `node_modules`.

---

## Install

macOS (Apple Silicon or Intel):

```sh
curl -fsSL https://bimax-liard.vercel.app/install | bash
```

The installer detects your platform, installs to `~/.local/bin/bimax`, wires `PATH`, and
verifies with `bimax --version`. Inside a source checkout with `bun` + `go` installed, the same
script builds locally instead of downloading. Full detail: [docs/INSTALL.md](docs/INSTALL.md).

First run asks for a model API key (e.g. `NVIDIA_API_KEY`). BiMax is provider-agnostic — it
talks to any OpenAI-compatible endpoint.

## Use

Run `bimax` in any project directory and describe a task:

```
❯ fix the failing test in src/auth and explain what was wrong
```

BiMax plans, runs tools (read/edit/write/bash/search/graph, MCP servers), and streams the work
inline. Committed output goes to your terminal's native scrollback — the terminal owns
scrolling and history.

**Keys:** `Ctrl+G` command palette · `Ctrl+X` Mind HUD (the second mind: self-model, drives,
ledger) · `Ctrl+F` search · `Ctrl+O` logs · `Esc` stash · `Shift+Tab` cycle modes. `/help`
lists commands.

## What makes it different

- **Confidence in the margin** — the epistemic ledger surfaces per-turn verification, so an
  edit reads as backed-by-tests or unverified, inline.
- **Two-tier routing, made visible** — you see which mind (fast vs. deep) answered a turn.
- **The Mind HUD** (`Ctrl+X`) — a live model of the agent's own reasoning: weak spots, drives,
  ledger receipts.
- **Real sandboxing** — Bash runs under an OS sandbox (macOS seatbelt) with write and network
  floors.

## Development

```sh
npm ci                       # engine deps
npm run build                # typecheck + build the engine (tsc)
npm run test:ci              # jest, no coverage
cd tui && go test ./...      # TUI tests
./install.sh                 # build the single binary + install to ~/.local/bin
```

CI (`.github/workflows/ci.yml`) runs the engine typecheck/lint/test and the TUI build/test on
macOS and Linux for every PR to `main`.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — every subsystem, tool, and command.
- [docs/FEATURES.md](docs/FEATURES.md) — the highlight reel.
- [docs/INSTALL.md](docs/INSTALL.md) — install, build, and release.
- [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) — `NO_COLOR`, reduced motion, contrast, screen readers.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — notable changes.
- [PRIVACY.md](PRIVACY.md) — what data BiMax collects (short answer: it stays on your machine).
