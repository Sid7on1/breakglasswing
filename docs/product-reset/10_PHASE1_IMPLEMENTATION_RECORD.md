# Phase 1 implementation and qualification record

Status: **implementation complete; local qualification passed; fresh-Mac release qualification
external**, 2026-08-08. Base checkout: `715dda91`; all evidence below used the dirty working tree
containing this reset. No provider/model configuration was changed.

This status is deliberately split. The code and artifacts satisfy every gate this Mac can prove.
A developer machine—even with a temporary home directory—cannot truthfully impersonate a first-ever
quarantined install or erase years of TCC/signing history. Those release-lab rows remain explicit.

## Product boundary now enforced

| Surface | Bimax Terminal | Bimax for Mac |
|---|---|---|
| Engine capability boundary | No Desktop profile; generic provider descriptors only | Electron main supplies a local Desktop provider descriptor |
| Computer tools/native operation tools | Not registered | Registered by the Desktop-owned provider |
| CU commands and computer-task routing | Absent | Provider-owned; visible pause/takeover control is Phase 5 Target |
| `ui_snapshot.computer` | Not emitted/rendered | Available to Desktop |
| Native CU payloads | None in Go embeds or release archive | XPC service, bridge and helper inside `Bimax.app` |
| Script/editor protocol | Public `bimax --headless` NDJSON path | Same versioned engine protocol through supervisor |
| Release platforms | macOS arm64/x64 | macOS arm64/x64 |

Phase 4 superseded the temporary `BIMAX_HOST_PROFILE` switch described by the original Phase 1
record. The Go launcher and direct engine now have no Desktop capability profile. Electron main
supplies only `BIMAX_HOST_CAPABILITIES_JSON`; the shared TypeScript engine contains no CU
coordinator. See `15_PHASE4_DESKTOP_CAPABILITY_RECORD.md` for the current boundary.

The protocol config allowlist contains no `computer*`, native-routing, helper or capture setting, so
Terminal configuration serialization does not expose Desktop-only controls. Persistent config can
retain those values for the app without making them effective in Terminal.

## Executed evidence

All normal release-gate stages passed:

- TypeScript build and protocol mirror: v3, 18 message tags, byte-identical generated mirror.
- Jest with real browser gate: 230/230 suites; 2,191 executed tests passed; 6 macOS sandbox cases
  were suppressed only by Codex's nested sandbox.
- Those sandbox files were then run outside the nesting: 17/17 passed, including the six previously
  skipped cases. Unique executed product cases: **2,197/2,197 passed**.
- Go Terminal: `gofmt`, `go vet ./...`, `go test ./...`, release build and protocol round trips pass.
  Correction, 2026-08-09: re-measured on Go 1.26.4, `gofmt -l` flags one file, `tui/markdown.go`.
  It is a comment-list indentation difference from a newer gofmt, the file is unmodified in `HEAD`,
  and `go vet ./...` and `go test ./...` still pass. So this row was true on the toolchain that
  produced it and is not true on the current one. Recorded rather than silently reformatted, because
  `tui/markdown.go` is outside the Phase 2 slices that found it.
- Clean temporary install, real PTY launch/render/quit, CLI help and version pass.
- Offline coding pipeline: **7/7** external-graded repair trajectories pass with no recovery. Raw
  report: `benchmarks/autonomy/results/run-2026-08-08T14-40-29-200Z.json`; raw episode bundles live
  beside it. This is pipeline evidence, not a live-model autonomy score.
- Review derivation, multi-file verification scope, abort-before-tool, command abort, session resume,
  interrupted-session chronology and dirty-worktree identity/preservation pass in the full suite.
- Desktop typecheck and Electron Vite production build pass.

The release gate's website dogfood probe could not bind a local port inside Codex's nested network
sandbox on its first run and was reported as not-run, not pass. It was then executed outside that
nesting: TUI launch/render/quit, CLI help, and the headless site load all passed; the site screenshot
is retained under `.bimax/dogfood/`. The separate browser-gated product tests also passed.

## Release artifacts

Terminal archives contain exactly one top-level binary, match their checksums/architectures, and
contain no CU service/driver/bridge/helper/PiP member.

| Artifact | SHA-256 |
|---|---|
| `bimax-darwin-arm64.tar.gz` | `f1c8903091f62f1c3b036fe4d83d46c760acc70edd52934877a9fa68e0792e26` |
| `bimax-darwin-x64.tar.gz` | `a186435ccc71efb1b2262f514cf69108fb3c8111de077187c8972cf4794d2b32` |
| `Bimax-1.1.0-arm64.dmg` | `c8417ddcb9e3740bfd5a5ae7e75e89fdc2201fcc3e03437c855a8d575f6260f3` |
| `Bimax-1.1.0.dmg` (x64) | `8183ff78dc2dc9efff8ade4e863e26c20114b6405cf16c7611ff4de9a632dad6` |

Both real app bundles pass `verify-desktop-package.mjs`: `Contents/Resources/engine/bimax-engine`,
`Contents/XPCServices/BimaxCuService.xpc`, `Contents/MacOS/bimax-cu-bridge`, and
`Contents/MacOS/bimax-desktop-helper` existed, were executable and matched the app architecture.
Phase 4 added `Contents/MacOS/bimax-mac-capability` and replaced the temporary Desktop host profile
with the generic provider descriptor. The XPC plist's identifier, executable and `XPC!` package
type are checked from the artifact, not inferred from YAML.

These local artifacts are unsigned manual-install alpha builds. The hashes identify them; they are
not signatures. Stable signing/notarization remains Phase 7 and is not silently counted here.

## Measured shipped-binary budgets

The verifier starts the actual arm64/x64 release binaries with a new extraction cache, parses every
stdout line as JSON, requires protocol v3, correlates 20 sequential pings, and injects hostile
Desktop environment variables to prove the launcher strips them. `/computer` must also be absent
from live command completion.

| Release | Cold ready (budget 5,000 ms) | Warm ready (budget 2,500 ms) | Ping p95 (budget 100 ms) |
|---|---:|---:|---:|
| arm64 native | 3,609.1 ms | 420.4 ms | 2.7 ms |
| x64 under Rosetta (diagnostic, not native SLO) | 5,044.4 ms | 1,907.4 ms | 37.2 ms |

Rosetta cold results varied from 3.6s after translation caching to 8.0s on the first execution of a
new embedded engine hash. Those runs are retained as diagnostics and are not counted as a native
Intel latency pass. Warm protocol and interaction behavior pass under Rosetta; a native Intel
fresh-Mac row remains required because Rosetta AOT translation is host work an Intel user never pays.
The gate requires native cold SLOs on the host architecture and labels foreign-architecture cold
timing `OBSERVED`, never `PASS`.

## Repeatable gate

`npm run phase1:check` is the same-machine composite gate. It first verifies the research contracts
exist, then runs the complete Terminal release gate, requires zero skipped macOS sandbox cases,
builds and inventories both Terminal archives, probes both shipped binaries, builds both app
architectures, opens the actual bundle/ASAR layout, typechecks Desktop, and verifies protocol mirrors.

## External release-lab gate still open

Run `08_ACCEPTANCE_GATES.md`'s fresh-Mac install matrix on the oldest supported and current macOS,
arm64 and native x64 where shipped. Phase 1 specifically needs evidence that a quarantined/manual-
override Terminal install produces **no Accessibility or Screen Recording prompt** and exposes no
built-in route capable of driving another app. Do not reset the owner's live TCC database and call
that a clean Mac; it is destructive and does not recreate signing/quarantine history.

Therefore the accurate handoff is: **Phase 1 code and local artifacts are complete and green. The
only remaining Phase 1 release qualification is external fresh-Mac/TCC evidence.**
