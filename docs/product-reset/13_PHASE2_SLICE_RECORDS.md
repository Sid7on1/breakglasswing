# Phase 2 slice records

Six delivered slices, each with its own evidence, mutation matrix and external-qualification
boundary:

1. **Slice 1** — supported Desktop runtime (Electron 43, macOS 13 floor) and the renderer
   sandbox / IPC validation baseline.
2. **Slice 2** — packaged runs resolve the engine and native components from the app bundle only.
3. **Slice 3** — app-owned Trust diagnostics.
4. **Slice 4** — native and compatibility baselines are never combined.
5. **Slice 5** — the existing executor router gains the one product ladder vocabulary.
6. **Slice 6** — packaged compatibility freeze, Trust Center view and typed action-receipt inspector.

## Slice 1 — supported Desktop runtime and IPC security baseline

Status: **Implemented; locally Measured; fresh-Mac and signed-distribution qualification external**,
2026-08-08. Base checkout: `715dda91` on `main`, working tree already carrying the Phase 1 reset.
All unrelated dirty-worktree changes were preserved. No provider or model configuration changed.

V-IDs from `12_ALL_VISION_SECTIONS_RESEARCH_PLAYBOOK.md`: **V02** (macOS-Aware Runtime — "renderer
receives only schema-validated data through a narrow preload API"), **V30** (Agent Action Security —
validate at the boundary, not inside the effect), **V32** (macOS Security Integration — hardened
runtime and entitlement audit for Electron on macOS).

Gates this slice answers, from `08_ACCEPTANCE_GATES.md` → *Bimax Desktop coding gate*:

- "Electron is on a currently supported major/minor line and the chosen minimum macOS is enforced by
  app packaging and native targets";
- "project file, PTY and git IPC reject traversal/malformed payloads";
- "code task works with zero CU permissions".

## What changed

### Runtime

| Package | Before | After |
|---|---|---|
| `electron` | `^33.2.0` (installed 33.4.11) | `^43.3.0` (installed 43.3.0) |
| `electron-builder` | `^25.1.8` | `^26.15.3` |
| `electron-vite` | `^2.3.0` | `^5.0.0` |
| `vite` | `^5.4.11` | `^6.4.3` |
| `@types/node` | `^20.19.42` | `^24.10.1` |
| `@lydell/node-pty` | `^1.2.0-beta.12` | unchanged |

Electron 33 reached end of support on 2025-04-29. Registry evidence taken 2026-08-08 confirms the
research window in `02_RESEARCH_LEDGER.md` §7: the `electron` `latest` dist-tag is `43.3.0` and no
44.x is published, so 41/42/43 are the supported lines. The installed runtime reports Electron
43.3.0, Node 24.18.1, Chromium 150.0.7871.212 — `@types/node` was moved to `^24` to match the actual
main-process runtime rather than the previous two-major gap.

Vite moved to 6 for a specific reason, not for currency: electron-vite 5 declares its public config
types in terms of Vite's `BuildEnvironmentOptions`, which Vite 5.4 does not export, so
`electron.vite.focus.config.ts` failed to typecheck on the Vite 5 / electron-vite 5 pair even though
that pair is inside electron-vite's declared peer range. React and Tailwind plugins were deliberately
left on their existing majors; this slice is not a frontend upgrade.

### macOS floor

macOS 13 is now declared in two places that actually enforce it:

- `app/electron-builder.yml` → `mac.minimumSystemVersion: "13.0"`, which electron-builder writes into
  `LSMinimumSystemVersion`, so the OS refuses to launch the app below the floor;
- `native/BimaxComputerUseKit/Package.swift` → `platforms: [.macOS(.v13)]`.

The floor is a Bimax product decision, stricter than Electron 43's own requirement. The independent
technical reason is already recorded in `docs/BIMAX_CU_SECURITY_MODEL.md`: `NSXPCConnection`
code-signing requirements, evaluated by Foundation against the immutable audit token on every
message, exist from macOS 13; below that the service degrades to the weaker PID-based Security check.
Electron 44 raising its own floor to 13 means this boundary will not need moving again at the next
runtime upgrade.

### IPC security baseline

New module `app/src/main/security.ts` — deliberately **Electron-free**, so the full policy matrix runs
as ordinary unit tests, the same way `app/src/main/supervisor/` does. It owns:

- `REQUIRED_WEB_PREFERENCES` — `sandbox`, `contextIsolation`, `nodeIntegration: false`,
  `nodeIntegrationInWorker/InSubFrames: false`, `webviewTag: false`, `webSecurity`,
  `allowRunningInsecureContent: false`, `experimentalFeatures: false`. Every flag is stated rather
  than inherited from an Electron default, because a silent default flip must fail a test, not a user.
- `RENDERER_CSP` — sent as a response header from the main process (the copy the renderer cannot
  edit) in addition to the existing meta tag. `connect-src 'self'` means the renderer has no network
  reach at all; every model call belongs to the engine child. `object-src`, `frame-src`, `base-uri`
  and `form-action` are `'none'`; `'unsafe-inline'` remains style-only, never script.
- `isTrustedSender` — a message is honoured only from the live Bimax window's **top** frame loaded
  from our own content. Subframes, other `webContents`, remote origins, `data:`/`about:blank`
  documents, destroyed frames and post-teardown messages are all refused. `localhost` is trusted only
  when a dev server is actually configured, so a packaged build cannot be talked to by one.
- `isAllowedNavigation` / `isAllowedPermission` — the window may only ever be on its own document
  (`will-navigate` and `will-attach-webview` are blocked, http targets handed to the system browser),
  and every Chromium permission request is denied outright.
- Payload validators — `asBoundedInt`, `asBoundedString`, `asPtyInput`, `asFileContent`,
  `asSupervisorAction`, `isProtocolFrame`, `resolveWithinRoot`, `asGitPathspec`. These **validate**
  rather than coerce: the previous `Number(x) || fallback` / `String(x)` idiom silently accepted
  `'24'`, `NaN`, `Infinity`, `1.5` and `null`.

All 22 privileged channels are registered through `secureHandle` / `secureOn`. `ipcMain.handle` and
`ipcMain.on` now appear exactly twice in `app/src/main/index.ts` — inside those two helpers — and a
test asserts that count, so a future channel cannot quietly skip the gate.

### Two containment escapes found and fixed

These were found by reconciling `01_CURRENT_REPO_AUDIT.md`'s security section against the source. The
audit said context isolation and CSP were in place, which was true; it did not catch either of these.

1. **Empty project root defeated the file guard.** `app/src/main/files.ts` compared a resolved path
   against `root + path.sep`. `projectDir()` returns `''` when no project is open — the documented
   project-first welcome state — so the check became `abs.startsWith('/')`, true for every absolute
   path on the machine. `files:read` and `files:write` reached the whole filesystem. The replacement
   requires an absolute root and fails closed when there is none.
2. **`git diff --no-index` read arbitrary files.** `git:diff` passed an unconstrained renderer path
   to git. Unlike a normal diff, `--no-index` resolves its operands as plain filesystem paths rather
   than repository pathspecs, so an absolute path returned the contents of any file. Containment now
   happens inside `gitDiff` itself, so it holds regardless of caller.

Both now share one resolver, which also refuses NUL bytes before any syscall can see a truncated
path, and refuses the sibling-prefix case (`/p/proj-evil` is not inside `/p/proj`).

## Executed evidence

All on this machine, 2026-08-08/09. Local qualification only — see the external section below.

- `npm --prefix app run typecheck` — passes.
- `npm --prefix app run build` (electron-vite 5 / Vite 6) — main, preload and renderer all build.
- `swift build -c release` in `native/BimaxComputerUseKit` at the raised floor — "Build complete!"
  with no new diagnostics; the only warning is the pre-existing
  `NSWorkspace.fullPath(forApplication:)` deprecation, which predates this slice.
- `npm --prefix app run dist:mac` — packages on `electron-builder 26.15.3` with
  `electron=43.3.0`, including the `@electron/rebuild` pass over the native `@lydell/node-pty`
  dependency. Unsigned, as expected without a Developer ID identity.
- `npm run verify:desktop-package -- app/release/mac-arm64/Bimax.app arm64` — PASS on all three
  rows: bundle layout, arm64 engine/XPC/bridge/helper, and the Desktop-profiled packaged engine.
- `src/__tests__/desktop.runtime.security.test.ts` — 43 cases, all passing.
- Full engine suite with the real browser gate on (`BIMAX_BROWSER_E2E=1 npm run test:ci`) —
  231/231 suites, 2,240/2,240 tests, zero failures and zero skips. Phase 1 recorded 230 suites and
  2,197 unique executed cases; the deltas are this slice's own suite and its 43 cases.

### End-state evidence taken from the artifact, not the source tree

Read back out of the packaged `app.asar` rather than `app/src`:

| Property | Result |
|---|---|
| `LSMinimumSystemVersion` in the shipped `Info.plist` | `13.0` |
| Runtime in the shipped framework | `Chrome/150.0.7871.212 Electron/43.3.0` |
| `sandbox` / `contextIsolation` / `nodeIntegration:false` in packaged main | present |
| `will-navigate`, `onHeadersReceived`, `setPermissionRequestHandler`, CSP header | present |
| Raw `ipcMain.handle` / `ipcMain.on` call sites in packaged main | **2** (the two helpers) |

### Real-runtime probes

Two properties could pass a unit test built on fakes and still be wrong in the real runtime, so both
were measured against Electron 43 directly, loading the actual compiled `security.ts`:

- **The sender guard does not dead-lock the app.** A guard that wrongly refuses its own renderer
  would leave the product completely inert while every containment test still passed. Measured:
  `senderFrame` exists, `senderFrame === senderFrame.top` is true for the main frame, the frame URL
  is `file://…`, `isTrustedSender` returns **true** for the app's own window, and
  `webContents.getLastWebPreferences().sandbox` is **true** — the renderer is genuinely sandboxed.
- **The CSP header actually governs `file://` documents.** It was not obvious that
  `webRequest.onHeadersReceived` applies to file-scheme responses; if it does not, the meta tag
  would be doing all the work and the "renderer cannot edit it" claim would be false. Measured on a
  page carrying **no** meta CSP: an external `'self'` script ran, an injected inline script was
  blocked, and a `securitypolicyviolation` fired with `effectiveDirective: script-src-elem`,
  `blockedURI: inline`. The header is in force.

### Mutation results

Every guard was neutered in turn and the suite re-run. A check that only ever asserts the happy path
is not evidence, so each row below is a deliberate defect the suite caught:

| Mutation | Result |
|---|---|
| `sandbox: true` → `false` | 1 failed |
| `isTrustedSender` always returns true | 6 failed |
| Electron pin reverted to `^33.2.0` | 1 failed |
| Native floor reverted to `.macOS(.v12)` | 1 failed |
| `mac.minimumSystemVersion` deleted | 1 failed |
| Original buggy containment restored | 4 failed |
| `gitDiff` skips containment | 1 failed |
| `asBoundedInt` coerces via `Number()` | 1 failed |
| One channel returned to raw `ipcMain.handle` | 1 failed |
| CSP allows `'unsafe-inline'` script | 1 failed |
| `will-navigate` guard removed | 1 failed |
| `isAllowedPermission` returns true | 1 failed |
| `resolveWithinRoot` refuses **everything** | 7 failed |

The last row is the one that keeps this honest in the other direction: a guard that refuses every
path would satisfy every containment assertion above. It is caught by the working-path tests, which
exercise the real file tree, editor read/write and `git diff` against a real repository on disk.

## Boundary statements

- **No Computer Use route changed.** The fallback ladder, the coordinator, the XPC service and the
  focus broker are untouched. The only native-side edit is the Package.swift deployment target.
- **Terminal gained nothing.** The Terminal manifest still declares no Electron dependency, and the
  Terminal archive contents are unchanged by this slice.
- **No sections 28/29 code.** No privileged sensor, capability manifest, broker or marketplace
  surface was added. `security.ts` contains no TCC, Accessibility or Screen Recording reference.

## What remains Target

- Fresh-Mac qualification on the macOS 13 floor itself: a real macOS 13 machine, quarantined
  download, first launch, and the grant/revoke/regrant matrix. This checkout cannot produce it.
- Signed and notarized behavior on the new Electron line. Hardened runtime and entitlements are
  declared, but no Developer ID run happened here; Phase 7 still owns that.
- The rest of Phase 2: Trust Center and app-owned permission diagnostics, bundle-resolved CU
  components proven in packaged runs, the semantic → physical → visual → stop consolidation, and the
  typed action receipt inspector.
- The renderer bundle is a single 2.7 MB chunk. Not a security property and not in this slice, but it
  is the obvious thing the frontend reset (Phase 5) should split.

---

# Slice 2 — packaged Bimax.app resolves its executables from its own bundle

Status: **Implemented; locally Measured; fresh-Mac qualification external**, 2026-08-09.

V-IDs: **V02** (macOS-Aware Runtime — process/component ownership), **V32** (macOS Security
Integration — the responsible signed component is the one that actually runs). Roadmap: Phase 2
bullet 3. Build sequence: Workstream A.4 ("Make packaged Bimax.app the only production Computer Use
host") and A.5 ("Freeze the compatibility backend; it cannot silently activate in production").

## The defect

`05_TARGET_ARCHITECTURE.md` states that "a release build cannot walk to `../src` or silently compile
whichever engine happens to be beside it", and the Desktop CU gate requires that
"compatibility/legacy backends cannot silently activate in a production build". Neither held. In a
**packaged** run:

1. Every component honoured its environment override *first and unconditionally*. Launching the
   shipped app with `BIMAX_CU_SERVICE_BINARY=/tmp/anything` pointed the product at a foreign native
   service; `BIMAX_ENGINE_CMD` replaced the engine outright.
2. A missing bundled engine fell through to `node <repo>/dist/index.js` and then
   `npx tsx <repo>/src/index.ts`, resolved from a walked-up repo root — a shipped app quietly
   running source it never shipped.
3. Refusing an override in the main process would still not have been enough on its own: the engine
   child inherited `...process.env`, and the engine reads these variables directly
   (`src/computer/native.service.client.ts`, `native.bridge.transport.ts`). A component missing from
   the bundle therefore left the hostile inherited value in place. This is the same shape of defect
   Phase 1 fixed on the Terminal side with `terminalBlockedEnv` in `tui/engine.go`.

## The rule now

`app/src/main/runtime.paths.ts` — Electron-free, every input injected (`app.isPackaged`,
`process.resourcesPath`, env, and filesystem probing), so the packaged case is tested directly
rather than inferred from a dev shell.

- **Packaged**: engine, XPC service, bridge and helper resolve from `Bimax.app` and nowhere else.
  Overrides are refused *and reported* — a silently ignored override is indistinguishable from a
  broken one, so each refusal is written to the engine log before the child starts.
- **Packaged, component missing**: reported as `missing`. It is never substituted from the override
  or from a dev tree. A missing *engine* throws `PackagedRuntimeError`.
- **Child environment**: all three engine-read variables are cleared, then only resolved values are
  set back.
- **Development**: unchanged. Every override still works, and the `dist` → `npx tsx` ladder is
  intact, because the native conformance scripts and the Go TUI tests drive those paths deliberately.
  The discriminator is `app.isPackaged`, never a build flag.

Phase 3 supersession, 2026-08-09: the preceding bullet records the Slice 2 state, not current
product reality. Phase 3 removed the implicit Desktop development ladder. Development now defaults
to the pinned staged engine artifact and retains only an explicit contributor override; see
`14_PHASE3_ENGINE_BOUNDARY_RECORD.md`.

## Executed evidence

- `src/__tests__/desktop.bundle.resolution.test.ts` — 26 cases, all passing.
- Full engine suite with the real browser gate on (`BIMAX_BROWSER_E2E=1 npm run test:ci`) —
  **232/232 suites, 2,266/2,266 tests**, zero failures and zero skips.
- `npm --prefix app run typecheck` — passes. TUI `gofmt`/`go vet ./...`/`go test ./...` — pass.
- `npm --prefix app run dist:mac` then
  `npm run verify:desktop-package -- app/release/mac-arm64/Bimax.app arm64` — **PASS ×4**, including
  the new row.

### The verifier was proved to detect the defect

`scripts/verify-desktop-package.mjs` gained three artifact-level checks. Run against the bundle built
*before* this slice it reported:

```
desktop package gate: FAIL: packaged main process does not refuse a development engine fallback
```

and against the rebuilt bundle it passes. The gate therefore grades the shipped artifact, not the
source tree.

Read back out of the rebuilt `app.asar`: refuses dev-engine fallback, reports refused overrides,
strips the native-component environment, gates on `isPackaged`, resolves the bundle XPC path. The dev
ladder still exists in the bundle — dev and packaged share one main process — but is unreachable
when `isPackaged` is true, which is what the unit matrix proves.

### Mutation results

| Mutation | Result |
|---|---|
| Packaged run honours `BIMAX_ENGINE_CMD` | 2 failed |
| Packaged run falls back to a dev engine when the bundled one is missing | 2 failed |
| Packaged run obeys a native-component override | 6 failed |
| A missing component substitutes the override value | 3 failed |
| Child-environment strip removed | 2 failed |
| Refusals resolved but not reported | 6 failed |

### One existing test was retargeted, not weakened

Moving the location and profile decisions out of `engine.ts` broke
`phase1.packaging.boundary.test.ts`, which grepped that one file for
`BIMAX_HOST_PROFILE: 'desktop'` and the three `Contents/` paths. The property was intact — it is
verified in the packaged ASAR — but the test's file assumption was stale.

Phase 4 later removed this temporary profile vocabulary and replaced it with the generic
`BIMAX_HOST_CAPABILITIES_JSON` descriptor. This paragraph records the historical mutation; it is
not the current engine contract.

It now reads the Desktop main-process sources as a set (`engine.ts` + `runtime.paths.ts`) and asserts
the same four required facts and the same exclusion. Nothing was deleted, skipped or loosened, and
the retargeted test was mutation-checked: renaming the XPC bundle path in `runtime.paths.ts` still
fails it.

## Boundary statements

- **No Computer Use route changed.** This slice decides *where components are found*; it starts,
  routes and verifies nothing. `runtime.paths.ts` contains no spawn/exec/XPC/AX reference at all,
  and a test asserts that.
- **Terminal untouched.** `tui/engine.go`'s `terminalBlockedEnv` strip list is unchanged and still
  covers all three variables; `gofmt`/`go vet`/`go test ./...` pass for the TUI.

## What remains Target

- Fresh-Mac evidence that a *quarantined, signed* app resolves and launches its nested components —
  the structural layout is verified here, signature validation at load time is not.
- Trust Center surfacing of refused overrides and component provenance to the user. Today a refusal
  is honest but only visible in the engine log.
- The rest of Phase 2: permission diagnostics, ladder consolidation, receipt inspector.

---

# Slice 3 — app-owned Trust diagnostics

Status: **Implemented; locally Measured; fresh-Mac and signed qualification external**, 2026-08-09.

V-IDs: **V32** (macOS Security Integration — "Trust Center shows the exact responsible signed
component… Core Code operates with all optional permissions denied"), **V02** (process/component
ownership). Roadmap: Phase 2 bullet 2. Gates: Desktop CU gate "packaged app, not a dev shell, owns
the permission and focus experience"; Desktop coding gate "code task works with zero CU permissions".

## Scope decision, stated rather than assumed

Phase 2 bullet 2 reads "Add Trust Center and app-owned permission diagnostics", while Phase 5 owns
the frontend recomposition and `competitive/07_BUILD_SEQUENCE.md` places the Trust Center surface in
Workstream E. Building a Trust Center **view** now would collide with that recomposition.

This slice therefore delivers the **diagnostics themselves** — an app-owned, testable, read-only
report behind one narrow validated channel — and deliberately does not add a renderer surface. The
data the future view needs now exists and is proven; the view is the next slice. This is a narrowing
of the roadmap bullet and is recorded as such rather than being presented as the whole item.

## What changed

`app/src/main/trust.ts` — Electron-free, every input injected, so packaged/denied/missing
combinations are testable without an Electron process or changing a permission on the developer's
machine. It reports build identity, macOS permission dispositions, the resolved component inventory,
coding availability, Computer Use availability with named blockers, and an explicit `unknowns` list.

`app/src/main/engine.ts` gained `componentResolutions()`, which reuses the **same** resolution the
spawn path uses. A diagnostics view that disagreed with the launcher would be worse than none, so
the two share one code path rather than re-deriving locations.

`trust:report` is registered through `secureHandle` like every other channel — a test asserts the
raw `ipcMain` call-site count is still exactly 2 — and the preload exposes one read-only method.

## The two properties this slice defends

1. **Coding availability is never a function of a macOS permission.** `coding.available` is derived
   from the engine component alone. Tests drive every permission to `denied`, then to `unavailable`,
   and then remove every Computer Use component, and coding stays available. Mutating the code to
   gate coding on `blockers.length === 0` fails three tests.
2. **An unknown is never reported as fine.** An unreadable permission normalizes to `unavailable`
   (not granted), `not-determined` blocks Computer Use, a component that did not resolve is
   `missing` with no path, and signature/notarization state is listed as *not evaluated* rather than
   omitted — omission would read as "signed". Phase 7 owns real signing.

Refused overrides from slice 2 now surface against the component that refused them, which was the
motivation for doing this slice next.

## Executed evidence

- `src/__tests__/desktop.trust.report.test.ts` — 23 cases, all passing.
- Full engine suite with the real browser gate on (`BIMAX_BROWSER_E2E=1 npm run test:ci`) —
  **233/233 suites, 2,289/2,289 tests**, zero failures and zero skips.
- `npm --prefix app run typecheck` — passes.

### Real-runtime probes

- **The permission APIs exist and do not prompt on Electron 43.** Measured directly:
  `isTrustedAccessibilityClient` and `getMediaAccessStatus` are both present;
  `getMediaAccessStatus('camera')` returned `not-determined` with no dialog, which is the proof that
  the query form does not prompt. The prompting variants (`askForMediaAccess`,
  `isTrustedAccessibilityClient(true)`) are asserted absent from the main process.
- **A full report assembles in real Electron.** With an inventory of engine present, one CU
  component missing and one carrying a refused override, the live run produced
  `coding.available: true` while `computerUse.available: false` with exactly one blocker naming the
  missing bridge. The run also self-demonstrated the unpackaged caveat: `appVersion` came back as
  `43.3.0` — Electron's version, because `app.getVersion()` falls back outside a packaged app —
  which is precisely the case `unknowns` warns about.
- **`componentResolutions()` executes** and reports honestly from a real Electron process.

### Mutation results

| Mutation | Result |
|---|---|
| Coding availability gated on permissions | 3 failed |
| Unrecognized permission value treated as granted | 1 failed |
| `not-determined` counted as granted | 2 failed |
| Signature/notarization caveat dropped | 1 failed |
| Refused override not surfaced on the component | 1 failed |
| Prompting permission API used instead of the query form | 1 failed |
| `trust:report` registered outside the guarded helper | 1 failed |
| Missing components not named individually | 1 failed |

## What remains Target

- **The Trust Center view itself** — the next slice, and the natural consumer of this report.
- Always-allowed apps, action history and diagnostics export, which the build sequence also assigns
  to the Trust Center.
- Real signature, notarization and cdHash reporting. The native `PermissionDoctor` already computes
  a code-directory hash and seal-intactness for the *service* process; surfacing the **app's** own
  signing identity needs the Phase 7 signing pipeline and is deliberately not inferred here.
- Fresh-Mac evidence of grant / deny / revoke / re-grant transitions. This slice proves the report
  is correct for a given permission state; it does not prove macOS transitions behave as expected.

---

# Slice 4 — native and compatibility baselines are never combined

Status: **Implemented; locally Measured**, 2026-08-09. Roadmap: Phase 2 bullet 6. Gates: Desktop
computer-use gate ("native arbitrary-task evaluation is reported separately from the narrow
exact-state benchmark") and the every-change gate ("claims name product, backend, model, build, run
count, discarded count, and raw artifact").

## Why this, and not the ladder

The intended next slice was the compatibility-backend freeze (Workstream A.5). Reading the source
first showed that is **not** a bounded slice: `DefaultBackendFactory` in
`src/computer/session.manager.ts` constructs `CuaCompatibilityBackend` as the only backend, so
freezing it would remove Computer Use entirely until a native production backend exists — which is
roadmap bullet 4 in its entirety.

Bullet 4 was then examined directly and is also not one slice: `src/computer/desktop.runtime.ts` is
7,232 lines, uses "fallback" 110 times, and contains **no executor-level concept at all** — no
`semantic | physical | visual | stop` type, and action receipts do not record which level acted. The
runtime's vocabulary is `background`/`foreground` delivery. Consolidating that is real work and
splitting it badly would leave a half-named ladder, which is worse than the current honest mess.

Bullet 6 was chosen instead: bounded, completable, no renderer surface, and it forces the *identity*
half of the ladder (which executor produced a number) without the consolidation.

## The defect, with evidence

`buildReport` already disqualified a suite for a mid-run model change, discarded runs, or a thin
class. It never looked at `backend`. Replaying the committed `frozen-v1.1.0.json` through the
**pre-change** code produced:

```
| form | 6 | 2/6 | 10 | 9 | 96508 | 67.5s |
> Frozen baseline: one model throughout, no discarded runs, at least 3 valid runs per class.
```

That record contains 14 measurements with `backend: "compatibility"` and **one, `form-checkbox`,
with no backend at all**. So the frozen v1.1.0 denominator pooled a run whose executor is unknown
and still called itself frozen. Across all 13 committed baseline records this is the only one
affected — both qualified comparison records are fully attributed.

Through the **post-change** code, the same bytes produce:

```
| compatibility | form | 5 | 2/5 | 11 | 10 | 107844 | 89.7s |
| unattributed  | form | 1 | 0/1 |  2 |  1 |  15691 |  6.3s |
> PROVISIONAL — not a frozen baseline. … 1 valid run(s) recorded no backend (form-checkbox) …
```

## The rule now

- Rows are keyed by **backend first**, then task class. Two executors never share a row.
- A suite that mixed executors is disqualified, for the same reason a mid-suite model change is: it
  describes no single system.
- A run with a missing/blank backend becomes an `unattributed` row and disqualifies the suite. It is
  **not** folded into a known executor, and it is not relabelled by inference.
- The passing verdict now reads "Frozen baseline **for the `<executor>` executor** … a baseline for
  this executor only and may not be quoted for any other."

## Executed evidence

- `src/__tests__/cu.baseline.report.separation.test.ts` — 12 cases, all passing, including one that
  replays the real `frozen-v1.1.0.json` and asserts it is refused.
- Full engine suite with the real browser gate on — **234/234 suites, 2,301/2,301 tests**, zero
  failures and zero skips.

### Mutation results

| Mutation | Result |
|---|---|
| Group by task class only (pool backends) | 4 failed |
| Mixed-executor disqualifier removed | 1 failed |
| Unattributed disqualifier removed | 2 failed |
| Missing backend defaults to `compatibility` | 4 failed |
| Backend column dropped from the table | 6 failed |

The first attempt at the middle two mutations reported 12 passed — the edit had not applied. They
were re-run with the change verified before the suite, which is the only reason they count.

## Document correction

`docs/BIMAX_CU_BASELINE_v1.1.0.md` asserted "Backend: compatibility … 15 valid runs total" and
printed `form 2/6`. Both are corrected: the attributed compatibility form figure is **2/5**, the
split table replaces the pooled one, the superseded reading is retained so the change is auditable,
and the two comparison tables are annotated because their `before` column used the pooled figure.
The status line no longer claims an unqualified FROZEN.

**The raw record was not touched.** `frozen-v1.1.0.json` is unchanged; only the reading of it is.
The unattributed run was very probably compatibility — native routing was signing-gated off on that
build — but it is deliberately not relabelled, because assigning an executor after the fact by
inference is exactly what this slice exists to prevent.

## What remains Target

- Roadmap bullet 4 (ladder consolidation) and bullet 5 (receipt inspector), both untouched.
- A native-executor baseline. There is no native row to report yet because the native route is not a
  production backend; when it becomes one, its baseline is measured separately and never merged.
- Re-running the v1.1.0 suite on the current harness to obtain a fully attributed record. The
  existing one stands corrected rather than re-measured, because re-running it now would be a
  different build and therefore not the v1.1.0 denominator.

# Slice 5 — name and attribute the existing executor ladder

Status: **Implemented; locally Measured**, 2026-08-09. Roadmap: Phase 2 bullet 4 attribution
foundation. Gates: Desktop computer-use gate (forced semantic, physical, visual and stop paths;
action receipts bind executor) and the every-change mutation rule.

## Reuse decision

`src/computer/surface.ts` already owns the routing decision in `chooseMechanism`, returning the
runtime's real `AutomationMechanism`; `BimaxComputerRuntime` already records the mechanism finally
used, including a late switch to Accessibility when a semantically named physical click is
occluded. A second router would let the receipt and the real launch disagree.

This slice therefore adds only `src/computer/executor.ladder.ts`, a mapping from that existing choice
to the product's four names, plus one finalize step in `BimaxComputerRuntime.run()`. It does not
replace a delivery path, add a new fallback or touch Terminal ownership.

## The attribution rule now

- `accessibility` and `browser-automation` map to **semantic**.
- `physical-foreground` and `sidecar-background` map to **physical**. Background describes focus
  behavior, not a semantic AX action.
- A target grounded in screenshot pixels or on-device OCR/Vision is **visual**, even when the event
  was ultimately delivered through AX or native input. The weaker grounding is the honest claim.
- A refusal is **stop**, regardless of which mechanism was contemplated.
- Every public `run()` clears the prior action's mechanism/executor first. Observation and early
  refusal cannot inherit the preceding click's attribution.
- A successful uninstrumented compatibility action is left without executor attribution. It is not
  called stop (it acted), and it is not silently assigned a flattering level.

The existing `AutomationMechanism` remains in diagnostics beside the product-level executor. This
keeps raw delivery facts available without exposing mechanism names as user-facing modes.

## Executed evidence

- `src/__tests__/executor.ladder.test.ts` and the affected surface/runtime suites: **3/3 suites,
  197/197 tests passed**.
- Full engine suite with the real browser gate on (`BIMAX_BROWSER_E2E=1 npm run test:ci --
  --runInBand --testTimeout=30000`): **235/235 suites passed; 2,304 tests passed and 6 were skipped
  out of 2,310**. The six skips are the pre-existing real-kernel sandbox cases: this host reports no
  supported OS sandbox backend, so two `exec.sandbox` and four `sandbox.floor` enforcement tests do
  not run. The browser E2E test did run.
- Strict TypeScript check passed with the repository root widened (`npx tsc --noEmit --rootDir .`).
  The unmodified `npx tsc --noEmit` command still hits the pre-existing `rootDir: ./src` conflict
  caused by tests importing `app/` and `scripts/`.
- ESLint reported zero errors. Its 517 warnings are pre-existing warnings in the 7,000-line runtime
  and 5,000-line test file; the new ladder module and its focused test added none.

### Mutation results

| Mutation | Result |
|---|---|
| Map Accessibility/browser automation to physical | 3 failed |
| Ignore visual grounding and report only delivery | 2 failed |
| Retain the previous action's mechanism/executor across `run()` | 1 failed |
| Let a contemplated physical mechanism outrank a refusal | 1 failed |

Each mutation was applied to the implementation, verified to fail, and restored before the final
run.

## What remains Target

- Forced semantic, physical, visual-recovery and stop postcondition tests against the packaged app.
- Freezing/removing the compatibility backend from production. `DefaultBackendFactory` still builds
  it as the only backend, so disabling it now would disable Computer Use rather than consolidate it.
- The full typed receipt contract (target app/window, observation/frame ID, executor, timestamps and
  postcondition) and its basic inspector. This slice adds executor attribution to the existing result
  but does not claim that broader Phase 2 bullet 5 surface.
- Fresh-Mac permission, focus/background and native-path qualification.

# Slice 6 — close the local Phase 2 product surfaces and freeze packaged fallback

Status: **Implemented; locally Measured; packaged fixture and fresh-Mac qualification external**,
2026-08-09. Roadmap: Phase 2 bullets 2, 4 and 5. Gates: app-owned permission experience,
typed action receipts, truthful background/foreground display and “compatibility/legacy backends
cannot silently activate in a production build.”

## What changed

- The existing read-only `trust:report` IPC is now rendered as a Trust Center inside Support. It
  shows coding and Computer Use separately, the two non-prompting permission readings, the exact
  resolved engine/service/bridge/helper inventory, blockers and unknowns. Opening or refreshing it
  never requests a macOS permission.
- The transcript recognizes both the native `semantic.action.receipt` contract and the existing
  compatibility action result. The native inspector shows target app/PID/window, bound snapshot,
  executor level, background/foreground state, duration, outcome and postcondition. Missing facts
  say `not recorded`, `unknown` or `unattributed`; they are never synthesized from the request.
- `BimaxActionTool` now attaches the already-resolved target application identity to the native
  service receipt. The underlying service receipt remains the authority for element/snapshot,
  delivery path, timestamps, focus lease and evidence.
- Electron main stamps `BIMAX_DESKTOP_RELEASE_MODE=packaged` only from `app.isPackaged`, stripping
  any inherited spoof. In that mode the engine attempts the full signed native surface and never
  registers `ComputerTool`. If cutover fails, Computer Use is visibly unavailable rather than
  falling through to `CuaCompatibilityBackend`. Development retains the compatibility surface for
  qualification; Terminal still receives no Computer Use surface.

The production routing decision is a small pure policy consumed by the existing container. It does
not add another executor or replace `chooseMechanism`.

## Executed evidence

- Focused routing, child-environment, native-tool, ladder, runtime, Trust Center and
  receipt-inspector contracts: **7/7 suites, 233/233 tests passed**, including the existing forced
  semantic, physical, visual and stop unit/integration cases.
- Full engine suite with browser E2E explicitly enabled: **238/238 suites passed; 2,313 tests passed
  and 6 were skipped out of 2,319**. The two browser runtime E2E assertions ran and passed. The six
  skips are the pre-existing real-kernel sandbox cases this nested host cannot execute.
- Desktop TypeScript, repository TypeScript (`--rootDir .`) and the Electron Vite production build
  pass; the renderer build includes the Trust Center and receipt card.
- A fresh unsigned arm64 manual-alpha bundle was built with Electron 43 and the compiled engine,
  XPC service, bridge and helper. `verify-desktop-package.mjs` passed against the real
  `app/release/mac-arm64/Bimax.app` ASAR and explicitly proved the packaged release marker that
  selects native-only, fail-closed routing. This is structural package evidence, not a signed or
  live fixture result.
- Changed-file ESLint reports zero errors. Its five warnings are pre-existing warnings in
  `src/core/container.ts`.

### Mutation results

| Mutation | Result |
|---|---|
| Give Terminal a compatibility Computer Use surface | routing contract failed |
| Let packaged Desktop register the compatibility backend | routing contract failed |
| Trust an inherited packaged-release environment marker | child-environment contract failed |
| Classify native `ax_action` as physical | receipt-inspector contract failed |
| Remove resolved target app/PID/window from the native receipt | native-tool contract failed |
| Render denied Computer Use as available | Trust Center view-model contract failed |

Every mutation was applied, observed failing, and restored before the final focused and full runs.

## What remains Target

- Run the four forced executor paths through the staged packaged app and fixture, proving each
  postcondition from a fresh end state. Unit/integration forcing is not a packaged-app result.
- Run M02’s persistent 7:30 PM fixture state, Notes keystroke log and foreground-transition log.
- Run oldest/current macOS and arm64/native-x64 clean-machine permission, revocation and first-launch
  rows. This development Mac cannot manufacture clean TCC/quarantine/signing history.

Therefore Phase 2’s local product surfaces and production fail-closed policy are implemented, but
the phase exit is **not complete** until those packaged and fresh-machine rows pass.

# Slice 7 — M02 persistent background fixture and honest physical/capture claims

Status: **Implemented; locally Measured**, 2026-08-09. Roadmap: Phase 2 forced-path and M02
qualification. Gate: `competitive/examples/M02_BACKGROUND_MAC_ACTION.md`.

The existing AppKit fixture now carries one persistent `Mom demo` reminder plus an unrelated
`Dentist` row. The same executable under a separate inert bundle identity records synthetic
bystander typing. `M02Conformance` mutates the exact background AX control, checks the other row,
foreground PID and every bystander keystroke, then terminates and reopens the target before grading
the stored state. The direct-native run passed 9/9 checks.

That run also falsified the old physical claim: `CGEvent.postToPid` returned without error while
both the service read-back and independent AX observation showed no target change. Verification now
requires a performed receipt and non-false effect evidence; the targeted-event capability is false.
The first visual attempts exposed `SCFrameStatusSuspended`, and the conformance target-selection
logic was found to be choosing a 33-pixel auxiliary window rather than the real fixture window.

# Slice 8 — complete Phase 2 implementation and local packaged-component qualification

Status: **Phase 2 implementation complete; local packaged-component qualification passed**,
2026-08-09. The app-owned bridge journey and clean-machine/release qualification remain evidence
gates.

## What changed

- Foreground physical typing now uses the real HID/WindowServer stream only after an explicit,
  target-bound approval, exact-PID focus lease, human-input quiet period and center click on the
  same live AX element. The value is independently read back before the capability is verified.
- Exact-window capture filters out auxiliary windows. The live `SCStream` path now returns complete
  frames; macOS 14+ also has an availability-guarded `SCScreenshotManager` one-shot fallback.
- `--self-test-stop` attempts foreground physical typing without coordinator approval and proves
  the service returns `foreground_approval_required` before either focus or the target value changes.
- A process-wide takeover latch covers compatibility and packaged-native execution. Every native
  mutation rechecks it immediately before the bridge; observation and capture remain available,
  and only explicit resume releases it. Phase 4 moved ownership out of the engine and Phase 5 owns
  the visible user control.
- `app/scripts/computer-use/conformance-bimax-cu-packaged.mjs` drives the service binary from the rebuilt app bundle,
  checks the package’s bundle-only identity, hashes its executable/ASAR/bridge/service, forces the
  semantic, physical, visual and stop rows, repeats M02, and preserves one raw JSON report.

## Executed evidence

- Packaged arm64 matrix: **11/11 assertions passed** — structure, bundle ownership, protocol,
  architecture, capacity, compiled takeover interlock, semantic, physical, visual,
  stop-before-effect and M02 exact state.
- Physical catalog: `type_text` performed via `CGEventPost:cghidEventTap:unicode`, with receipt
  `honored: true` and independent `effectObserved: true`; no advertised action was overclaimed.
- Visual capture: **4 complete frames**, 1120×984, complete frame status, no fallback required.
- M02: **9/9** checks; `Mom demo` persisted at 7:30 PM, `Dentist` stayed at 9:00 AM, foreground PID
  was stable and bystander keystrokes were exact.
- Stop: missing approval was refused before delivery; target value and foreground PID were unchanged.
- Takeover: an action prepared before pause was refused with `computer_use_paused`, made zero
  transport calls, then performed only after explicit resume.
- Native executable suite: **60/60 passed**. Desktop typecheck, repository typecheck and the normal
  repository `npm run build` passed (build now excludes Jest-only sources). Full engine suite:
  **237 passed, 1 skipped suite; 2,312 passed, 8 skipped tests out of 2,320**. The skipped cases are
  existing environment-gated cases, not Phase 2 rows.
- Rebuilt `Bimax.app`: arm64 application, engine, service, bridge and helper passed the structural
  package gate. The local artifact is unsigned because no valid Developer ID identity exists.

Raw run:
`app/benchmarks/computer-use/results/phase2/run-2026-08-09T08-13-12.423Z/report.json`.

## Chipset, capacity and network alignment

The report records the measured host as Apple M3/arm64, 8 logical CPUs and 8 GiB memory, asserts
the bundled service architecture matches, records negotiated `bimax.cu.v1`, and verifies positive
session/capture/element limits. It records interface type facts without IP addresses. Node cannot
establish `NWPath` expensive/constrained state or endpoint RTT, so those fields are `unknown`.

This satisfies Phase 2’s macro constraints without promoting the wider “chipset-native” vision.
`12_ALL_VISION_SECTIONS_RESEARCH_PLAYBOOK.md` already contains the `MachineProfile`,
`NetworkProfile`, policy algorithm portfolio, mutation experiments and sample decisions. Actual
thermal/Metal/network adaptive policy remains **Target** until the supported-device benchmark
corpus proves a named policy beats the static baseline without interaction or correctness loss.

## Remaining qualification boundary

No local component implementation/qualification row remains. The preserved matrix invokes the
service executable shipped in `Bimax.app`; it does not claim that Electron drove the same actions
through the production engine → bridge/XPC route. That end-to-end packaged journey still has to be
recorded. Clean macOS 13/current macOS, quarantined first launch, permission revocation/regrant,
native Intel where shipped, stable Developer ID identity, notarization and stapling remain external
release qualification. None become Product-ready evidence by relabeling this unsigned local run.
