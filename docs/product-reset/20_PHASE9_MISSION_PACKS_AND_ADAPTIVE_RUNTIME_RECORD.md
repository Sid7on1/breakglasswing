# Phase 9 record — mission packs, ML Alchemist and adaptive runtime

Date: 2026-08-10

Status: **Implemented locally**, not Measured or Product-ready across the external device and
distribution matrix.

This record closes the locally implementable Phase 9 work in owner sections 28 and 29. It does not
upgrade an injected worker, deterministic simulator fixture, or replay trace into proof from a real
device. The status vocabulary is the one defined in `competitive/README.md`.

## Product boundary

- Bimax Terminal remains the coding product. It gained only a bounded background-concurrency input;
  the immutable four-worker ceiling remains in Terminal.
- Bimax for Mac remains the only Computer Use owner and the only process that launches optional
  native/capability workers.
- No Endpoint Security, Network Extension, TCC, XPC, or Computer Use implementation was added to
  Terminal.
- No privileged entitlement was added. A missing entitlement remains a supported configuration.

## Implemented slices

### S28-D — Bimax-launched process provenance

`app/src/phase9/process.provenance.ts` records only children launched by Desktop. A random launch id,
not a PID, is the identity. Records contain executable basename/digest/signer, classified arguments,
classified working directory, lifecycle, bounded endpoint metadata and explicit completeness. Raw
argv, environment values, payloads and system-wide processes are outside the contract.

The engine launcher in `app/src/main/engine.ts` now begins and closes a provenance record around the
real child. Desktop exposes a read-only bounded snapshot to the renderer.

### S28-E — learned anomaly ranking

`app/src/phase9/anomaly.ranker.ts` is an auditable k-nearest-neighbour ranker over named causal
features. It refuses an undersized or mixed-version corpus, reports calibration independently and
can only rank a review. It has no block, isolate, repair, authorization, or deadline API.

The algorithm is Implemented. It remains **Target** as a product feature because no maintained
labeled corpus or measured false-positive/notification budget exists.

### S29-C — out-of-process capability worker

`app/src/phase9/capability.worker.process.ts` implements the broker worker boundary as a Desktop-
owned NDJSON child. It uses no shell, does not inherit the parent environment, binds protocol and
content digest in the hello frame, caps frames/pending calls, handles cancellation during handshake,
and fails outstanding calls after crash or malformed protocol.

Real catalog signing and operator promotion remain Target. Deterministic fixture identity is not a
substitute for a production signing key.

### S29-D — simulator adapters and optional Computer Use pack

`app/src/phase9/simulator.adapters.ts` supplies fixed-command adapters for Xcode-owned iOS simulator
tooling and official Android SDK/Gradle tooling. Reservation math preserves memory headroom; the
journey contract is build, test, observe, receipt, cleanup. Xcode owns Apple runtime downloads and
Android images are architecture-specific.

`app/src/phase9/computer.use.pack.ts` makes activation Desktop-only, prompt-free until the first
actual invocation, revocable, and honest about the separate macOS permission switch.

Local inventory found Xcode 26.6 plus `xcrun`, and Android `sdkmanager`/`adb`/`avdmanager`; an Android
`emulator` executable was not found. No real simulator or physical-device journey was run, so S29-D
is not Measured.

### S29-E — ML Alchemist

`app/src/phase9/ml.alchemist.ts` defines isolated MLX-research and Core-ML-deployment workflows over
opaque immutable artifact handles. Only non-pickle formats enter; digest, size and provenance are
checked before the worker. Baseline and candidate are evaluated on the same reproducibility
contract. A candidate must preserve behavior, quality and required devices and improve a measured
cost before export; export digest is checked again.

Neither `mlx` nor `coremltools` is installed in the inspected Python runtime. The workflows and the
degraded-candidate rejection are Implemented by deterministic contract, but real transform quality,
latency, energy and device support remain Target.

### S29-F — adaptive runtime and rendering

`app/src/phase9/adaptive.policy.ts` consumes architecture, CPU, free memory, pressure, thermal,
power, Low Power Mode (explicitly unknown when unavailable), network, interaction, Reduce Motion and
reserved workload. Only `background-concurrency` may act in the first canary. It constrains
immediately, relaxes after hysteresis, and is bounded to one through four. Rendering remains shadow
mode except Reduce Motion, which is an accessibility constraint.

Electron main owns OS signals and injects the selected concurrency into the engine child. Terminal
clamps that value again at its immutable hard ceiling. The renderer can report only interaction and
Reduce Motion; it cannot manufacture thermal state or widen capacity. A contextual Runtime inspector
shows the decision and privacy-safe Bimax-launched provenance.

## Frontend composition

The Phase 5 contextual inspector now includes a Runtime lane rather than adding permanent product
chrome. Its content is read-only and appears alongside Changes, Mac, Browser, Team, Receipt and
Files. The frontend identity is type-only `BiMAX`; there is no product glyph. Starlight and Moonlight
replace the ornamental warm themes with a white/black/silver token system.

## Local gate and mutation proof

`npm run phase9:check` passed on 2026-08-10:

- Terminal and Desktop typechecks;
- Desktop production build;
- 7 Phase 9 suites / 24 tests;
- adaptive Terminal capacity suite / 5 tests;
- Desktop-only Computer Use ownership scan;
- privileged-entitlement absence scan;
- six deliberately neutered implementations killed: invalid endpoint admission, undersized anomaly
  corpus, digest drift, Terminal Computer Use activation, degraded ML quality and capacity overflow.

The broader audit also removed five ESLint errors, repaired stale trust/packaging fixtures, made
evidence-schema switches exhaustive, regenerated the evidence mirror and passed the
affected 69 evidence tests plus 122 renderer/security/bundle tests. A fresh repository-wide engine
run excluding the one loopback-only takeover file passed **196 suites / 1,941 tests** (one suite and
eight tests skipped by their own contracts). The omitted takeover suite passed **25 tests** when run
with local-loopback authority and fails only at `listen(127.0.0.1)` in the managed sandbox. Desktop's
fresh bounded inventory passed **63 suites / 492 tests** with the real-timer-heavy
`bimax.computer.runtime.test.ts` excluded; that 177-case file had already passed in bounded groups
but its aggregate remains too slow for the short local command window and is not counted as a fresh
complete run here. The native Swift foundation passed **60/60**, the Go TUI suite passed, Phase 3's
standalone Desktop boundary passed, and root typecheck plus zero-error ESLint passed.

One final Terminal regression was found after mutation tests made evidence sources newer than the
compiled engine: the development launcher selected the `tsx` CLI, whose private IPC listener is
forbidden by managed builders. The source fallback now uses offline `node --import tsx`, a regression
test pins the exact socket-free command, and the complete Go TUI suite passes with stale `dist/`.

The renderer harness successfully selected its new file-URL fallback when loopback binding was
denied, but the managed environment then refused the Chrome process itself. No new screenshot or UI
journey is therefore claimed for the Starlight/Moonlight pass.

The existing arm64 Desktop package still passed all structural/component/ownership checks and the
manual-alpha mutation/rollback suite. A fresh Phase 2 live fixture rerun is not counted: the managed
host refused LaunchServices GUI launch and its TCC state denied Accessibility/Screen Recording.
The fixture executable itself was rebuilt, inspected as arm64 Mach-O and passed strict code-signature
verification, so this is recorded as an environment row rather than a source or package defect.

## Still Target or externally blocked

- Endpoint Security or Network Extension entitlement approval and associated queue/deadline/privacy
  measurements;
- maintained labeled anomaly corpus, false-positive and notification-volume budgets;
- real capability signing key, catalog operator, promotion/revocation ceremony and fresh-Mac
  activation journey;
- real iOS/Android build-test-observe matrix and physical-device rows;
- real MLX/Core ML transform corpus across supported Apple Silicon devices;
- signing, notarization, quarantine, TCC revoke/regrant and oldest/current supported macOS matrix;
- measured rendering/energy canary sufficient to move rendering out of shadow mode.

Those rows cannot be completed by source changes alone and must not be described as completed vision.
