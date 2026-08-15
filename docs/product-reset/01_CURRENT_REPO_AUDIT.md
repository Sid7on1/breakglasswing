# Current repo audit

Audited at `715dda91` on `main`; the worktree was clean. The repository was 23 commits ahead of
`origin/main` and unpushed at audit time.

## What already works

- The TypeScript coding engine has a real headless seam: `BIMAX_HEADLESS=1` and a versioned NDJSON
  protocol in `src/protocol/protocol.ts`.
- Both the Go TUI and Electron app spawn that same engine instead of maintaining separate agents.
- The Electron app already has a supervisor, generated protocol mirror, React renderer, CodeMirror,
  xterm, git/file panels, local CSP, context isolation, and no renderer Node integration.
- The app packaging config already places `BimaxCuService.xpc` under the app's XPC services and the
  bridge/helper under `Contents/MacOS`.
- The native Swift package has a protocol, service, bridge, fixture, conformance programs, semantic
  Accessibility actions, ScreenCaptureKit capture, focus leases, and physical-input arbitration.
- The computer-use benchmark now has a frozen denominator and a qualified 15/15 exact-state result
  for its narrow compatibility-backend grammar. The boundaries in handoff section 21 still apply.

This is why a rewrite of the coding agent or native service is the wrong first move.

## Where the boundary is wrong

| Current location | Current responsibility | Target owner |
|---|---|---|
| root `src/` | coding engine plus computer routing, policy, prompts, runtime, legacy compatibility | coding engine stays in Terminal; Mac operation moves to Desktop behind a capability seam |
| `tui/` | TUI plus embedded engine, CU driver, live PiP, desktop helper, and bare CU service | Terminal TUI plus engine only |
| `app/` | Electron UI, supervisor, native focus broker, packaging | Desktop |
| `native/BimaxComputerUseKit/` | Swift service/XPC/capture/AX/input/tests | Desktop |
| root scripts/benchmarks/docs | mixed coding, release, app, and CU jobs | split by product and test owner |

The production TUI currently embeds five binaries: the engine, compatibility computer-use driver,
live PiP, desktop helper, and a bare CU service. It does not embed the signed bridge or a containing
app/XPC layout. The app, in contrast, already has the correct bundle locations and passes all three
native paths to its child engine. Computer use belongs to the app.

## Coupling to remove

The split is not just moving `app/` and `native/`. Computer-use code is coupled into:

- `src/cli/personas/base.persona.ts` and `computer.playbook.ts`;
- `src/cli/commands/computer.ts` and computer config fields;
- model routing and installed-app phrase detection;
- `src/protocol/headless.session.ts` disposal behavior;
- `src/protocol/ui.snapshot.ts` computer posture;
- tool construction and the large `src/computer/` runtime;
- TUI protocol/status strips and embedded-binary extraction;
- root CI, release scripts, smoke tests, benchmarks, and documentation.

The safe sequence is therefore behavior-first: stop shipping CU in Terminal, make Desktop the only
host that injects the capability, then move implementation files. A filesystem-only split first
would create two broken repositories.

## Scale facts

These are working-tree measurements, not quality metrics:

- `src/computer`: 43 TypeScript files, about 17.5k lines.
- native Swift/C/H CU sources: 48 source files, about 18.1k lines.
- `app/src`: 51 source files, about 8.8k lines.
- top-level Go TUI: 43 Go files, about 9.8k lines.
- tracked files by large surface: TUI 1,347, engine `src` 624, benchmarks 159, app 64,
  scripts 62, site 57, native 50.

Disk size is misleading because ignored build outputs dominate (`app` was 2.3 GB and native 987 MB
locally). The ignore rules already cover app/node modules, renderer output, releases, native `.build`,
root build/coverage/dist, and local runtime state. “Clean the repo” means separate ownership and
release graphs; it does not mean committing or manually deleting generated directories.

## Existing frontend diagnosis

The current app is more complete than the user's first impression suggests, but it presents its
implementation inventory as navigation: Review, Files, Terminal, Agent Team, Code Map, Memory,
Health, multiple agent modes, autonomy, model, six appearances, project/branch state, and a second
resizable tool rail. The screenshots are visually coherent; the problem is product hierarchy.

The reset keeps the renderer stack and good components. It removes permanent navigation for
secondary diagnostics and makes the right side contextual to the current task. This is a UX
recomposition, not a theme contest.

## Security follow-ups already visible

The BrowserWindow uses context isolation and disables Node integration, and the renderer has a
restrictive local CSP. Before Desktop alpha, explicitly set `sandbox: true`, validate the sender on
every privileged IPC handler, validate all renderer payloads, and expose one narrow preload method
per operation. These are Electron's current published recommendations and are release gates, not
optional cleanup.

The app pins Electron `33.2.0`. Electron 33 reached end of support on 2025-04-29; Electron only
supports its latest three stable majors. Upgrade to the latest supported patch in an isolated change
before building the new frontend. Because Electron 44 drops macOS 12 and the native package currently
declares macOS 12, this plan recommends making macOS 13 the product minimum rather than preserving an
old OS boundary through a major security/runtime upgrade.

### Resolved, 2026-08-08 (Phase 2, slice 1)

Both paragraphs above describe the pre-slice state and are kept as the audit record. Current source:
Electron `^43.3.0`, macOS 13 declared by `app/electron-builder.yml` and the native `Package.swift`,
and `app/src/main/security.ts` now owns the window contract, CSP, sender/navigation/permission
policy and payload validation. Every privileged channel is registered through `secureHandle` /
`secureOn`; `ipcMain.handle` and `ipcMain.on` appear exactly twice in the main process, inside those
two helpers.

The audit's containment claim needed correcting rather than confirming. Two escapes existed:

- `files.ts` compared a resolved path against `root + path.sep`. With no project open the root was
  `''`, so the test became `abs.startsWith('/')` — true for every absolute path — and `files:read` /
  `files:write` reached the whole filesystem.
- `git:diff` passed an unconstrained path to `git diff --no-index`, which resolves its operands as
  plain filesystem paths rather than repository pathspecs, so an absolute path returned any file.

Both are fixed by one resolver (`resolveWithinRoot`) that fails closed when no project is open, and
both have regression tests. Status: **Implemented**, locally **Measured**; fresh-Mac rows unchanged.
