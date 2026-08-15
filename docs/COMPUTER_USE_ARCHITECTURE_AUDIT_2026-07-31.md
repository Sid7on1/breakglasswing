# Bimax computer-use architecture audit

Date: 2026-07-31

Priority: macOS-native first

Scope: Bimax compared with the local `codex`, `MacOS-Use`, and `hermes-agent` repositories

## Executive verdict

Bimax is not slow because it lacks computer-use features. It is slow because its strongest safety
properties are implemented as a maximum-cost path on nearly every primitive:

1. one model-visible action per assistant turn;
2. one global target/perception pipeline;
3. a screenshot plus accessibility walk after nearly every state-changing action;
4. repeated app/window discovery and reconciliation around that capture;
5. a large, mostly nullable action schema and substantial policy text sent to the model;
6. two native implementations whose behavior is reconciled in a 6,658-line TypeScript runtime.

The other implementations are faster for architectural reasons, not because they contain a single
better click function:

- Codex's exposed computer-use contract permits one or more actions between state reads and returns
  accessibility diffs by default.
- MacOS-Use uses in-process PyObjC, batched AX attribute reads, a two-stage tree walk, parallel
  per-application traversal, and no screenshot by default.
- Hermes keeps a persistent CUA session, negotiates live driver capabilities, makes post-action
  capture optional, supports distinct AX/SOM/vision modes, and reduces image size before model use.

The correct refactor is not to replace Bimax with any one of them. It is to preserve Bimax's exact
target identity, stale-frame refusal, input ownership, recipient preflight, receipts, recovery, and
user-takeover behavior while moving the hot path into a signed, long-lived macOS-native service with
diff snapshots and adaptive verification.

The recommended product shape is:

> semantic AX transaction first; event/diff receipt second; screenshot only when the action, app,
> risk, or ambiguity requires pixels.

This changes the default from “capture everything to prove every primitive” to “pay for the least
expensive evidence that can honestly prove this primitive.”

## Important correction to the current premise

Bimax does not contain a source fork of the CUA driver in this checkout.

- `THIRD_PARTY_NOTICES.md` identifies an embedded official `trycua/cua` 0.12.3 binary at source
  commit `407119202655433dbd4968574cb08ae7d1a01456`.
- `scripts/stage-computer-use-driver.sh` downloads the published release archive and copies its
  `cua-driver` binary into the Bimax package.
- `src/computer/desktop.runtime.ts` wraps that binary and labels it `bimax-computer-use 0.12.3`.

The substantial Bimax modifications are the TypeScript orchestration around the binary and an
independent Swift fallback/helper embedded in `src/computer/helper.source.ts`. Bimax cannot presently
change CUA's native AX traversal, capture, or delivery internals because those sources are absent.

This matters for the refactor decision:

- If Bimax wants to keep CUA as its primary backend, it must add a reproducible source fork/build.
- If macOS is the first priority, the cleaner destination is a Bimax-owned native service and a
  temporary CUA compatibility adapter during migration.

## Audit state and validation

Repository snapshots inspected:

| Repository | Commit | Date | Worktree |
|---|---|---:|---|
| Bimax | `598c71effcecc018cc710c487feeb2314400b770` | 2026-07-29 | 35 changed/untracked files |
| Codex | `53d06e24ea318a963812030fa8fed1bd0fc42d42` | 2026-07-31 | clean |
| MacOS-Use | `c88574c0a70534a21e9490e2118f1fce04e16904` | 2026-05-13 | clean |
| Hermes | `ce6dd1a65f4b6b20b1f3b31f75184a3e26583488` | 2026-07-30 | clean |

The Bimax conclusions apply to the current dirty worktree, because that is the implementation the
user is actively running and changing. Findings that may be introduced by those uncommitted changes
are called out separately.

Validation performed:

- `npx tsc --noEmit`: passed.
- Five focused computer-use/agent-loop suites: 252 passed, 1 failed.
- Failing test: background opening of an off-screen app unexpectedly calls `bring_to_front`.

That failure is a current behavioral regression against Bimax's own background-delivery contract. It
should be fixed before using the dirty worktree as a performance baseline.

No live GUI benchmark was run during this audit because it would operate the user's desktop. Existing
Bimax measurements are used where available; other latency conclusions are explicitly architectural.

## Extracted implementation map

### Bimax

Primary path:

```text
ComputerTool schema/governor
  -> agent-loop computer gates
  -> global BimaxComputerRuntime
  -> persistent SidecarTransport
  -> packaged CUA 0.12.3 binary
  -> AX tree + screenshot + input tools
```

Fallback and additional macOS path:

```text
BimaxComputerRuntime
  -> embedded Swift source
  -> swiftc compilation on first use
  -> cached native helper process
  -> CGEvent / AX / Vision / WindowServer / clipboard operations
  -> cliclick
  -> AppleScript
```

The runtime owns:

- app, process, window, display, frame, and surface selection;
- CUA session startup and reconnect;
- AX and visual element fusion;
- semantic targeting and re-grounding;
- physical input serialization and held-button cleanup;
- exact-recipient and occlusion checks;
- post-action evidence, verification, recovery, and action history;
- clipboard and cross-app drag;
- window arrangement, Spaces, PiP, and recording.

The feature set is broad, but the responsibilities are concentrated in
`src/computer/desktop.runtime.ts` (6,658 lines) and embedded Swift
`src/computer/helper.source.ts` (1,254 lines).

### MacOS-Use

MacOS-Use is a Python-native macOS implementation based on PyObjC:

- `macos_use/ax/core.py`: direct ApplicationServices AX wrappers and batched reads;
- `macos_use/ax/controls.py`: typed control abstractions;
- `macos_use/ax/patterns.py`: invoke, value, toggle, expand/collapse, scroll, selection, window,
  and text patterns;
- `macos_use/agent/tree/service.py`: pruned two-stage tree traversal;
- `macos_use/agent/desktop/service.py`: window state and optional screenshot;
- separate small action tools for click, type, scroll, move, shortcut, app, scrape, desktop, shell,
  wait, and done.

Its key hot-path choices are:

- `use_vision=False` by default;
- `AXUIElementCopyMultipleAttributeValues` instead of one AX IPC call per attribute;
- early attributes for every node, late metadata only for interactive nodes;
- pruning hidden and non-useful roles before further work;
- concurrent traversal across relevant applications and macOS system UI;
- in-process native calls rather than JSON/base64 through a sidecar boundary.

These choices are directly useful. Its safety semantics are not.

### Hermes

Hermes uses CUA through a large Python compatibility layer:

- a persistent daemon/MCP session per Hermes session;
- startup readiness and session revival;
- capability and input-schema discovery from live `tools/list`;
- one retry after dead transport and a CLI fallback for empty/heavy capture results;
- capture modes `ax`, `som`, and `vision`;
- default model-visible element limit 100, hard limit 1,000;
- optional `capture_after`;
- default max image dimension 1,456 and JPEG quality 85 on the direct screenshot path;
- per-snapshot element-token cache;
- explicit background/foreground delivery and separately approved `bring_to_front`;
- a typed browser route with tab/ref state, navigation, dialogs, uploads, and downloads;
- a dedicated doctor/permissions flow.

Hermes exposes more CUA capability than Bimax in some areas, including typed browser operations,
zoom, secondary backend operations, recording/replay/config surfaces, and capability negotiation.

Its wrapper is also evidence that CUA is an unstable abstraction boundary: it contains substantial
version compatibility, retry, parsing, and MCP/CLI fallback logic. Bimax should not copy that
complexity into another monolith.

### Codex

The open-source Codex repository does not contain the native computer-use implementation. It
contains:

- a stable `ComputerUse` feature flag;
- managed policy for locked-computer use;
- discovery of `computer-use@openai-bundled`;
- a reserved `computer` runtime namespace;
- app-server configuration plumbing.

The locally installed bundled plugin is proprietary. Its visible wrapper launches
`SkyComputerUseClient`, imports the packaged macOS `@oai/sky` client, and freezes a persistent
singleton. Its documented public surface includes:

- `get_app_state({app, disableDiff?})`;
- `click`, `drag`, `scroll`, `type_text`, `press_key`, and `set_value`;
- `perform_secondary_action`;
- `select_text`;
- `list_apps`.

The useful contract-level ideas are:

- full app state is AX text plus screenshot;
- the AX tree is a diff by default;
- element index is preferred, coordinates are fallback;
- more than one action may occur before the next state read;
- state lookup can transparently start an app in the background;
- the runtime performs adaptive settling before the next state read;
- secondary AX actions and text selection are first-class;
- safety policy is separate from primitive implementation.

Because the native implementation is proprietary and absent from the supplied Codex repository,
this audit makes no claim about its hidden capture, input, or AX algorithms.

## Capability and architecture comparison

| Area | Bimax | MacOS-Use | Hermes | Codex exposed contract |
|---|---|---|---|---|
| Primary native layer | packaged CUA binary + Swift helper | in-process PyObjC | packaged CUA via Python | proprietary macOS client |
| AX-first, no-image mode | supported per observe, not default action path | default | explicit `ax` mode | AX text always; image also returned |
| AX diff snapshots | no | no | no model-level diff | yes, default |
| Batched AX attributes under project control | no, inside opaque CUA | yes | no, inside opaque CUA | unknown |
| Screenshot policy | automatic after most actions | optional | explicit/optional `capture_after` | explicit state read after action group |
| Exact pid/window/frame identity | strong | weak | moderate | app + fresh element indexes |
| Stale-frame refusal | strong | absent | snapshot token mapping | re-fetch guidance |
| Recipient preflight | strong | absent | driver-dependent | unknown |
| Action receipts/postconditions | strong | weak | driver verdict | state re-read |
| User takeover/held input cleanup | strong | absent | limited | unknown |
| Multi-action transaction | no; prohibited by prompt/loop | no | no | exposed workflow permits it |
| Typed secondary AX actions | partial through custom verbs | broad patterns | backend-dependent | yes |
| Text selection | indirect | pattern support | browser/native varies | first-class |
| Capture modes | observe/screenshot flags | accessibility/vision/annotation | AX/SOM/vision | full/diff state |
| Image size/format controls | not model-facing | scale parameter | 1,456px/JPEG knobs | unknown |
| Driver capability negotiation | no | not applicable | yes | wrapper/native version owned together |
| Typed browser route | separate Bimax BrowserTool, not unified state | AX browser traversal | yes | Chrome guidance/instrumentation |
| Permissions doctor | status/request access | basic checks | dedicated doctor/UI | app-managed |
| App/window/Spaces/layout | very broad | broad | moderate | narrower visible surface |
| Safety/approval | strongest | intentionally permissive | moderate | extensive policy |
| Maintainability | low due concentration | moderate, alpha quality | low due wrapper size | thin visible wrapper |

## What Bimax should preserve

These are differentiators, not mistakes:

1. Exact `pid + windowId + frameId` ownership.
2. Refusal of stale raw coordinates and stale semantic handles.
3. AX event epochs and semantic re-grounding when the tree changes.
4. WindowServer/AX reconciliation for same-process sheets and multiple windows.
5. Recipient preflight before physical input and refusal on unresolved occlusion.
6. Serialized physical input with held-button recovery.
7. Human takeover and safe release of outstanding input.
8. Structured action receipts separating delivery, observation, postcondition, and confidence.
9. Honest degradation when screenshot, AX, or target ownership cannot be established.
10. Dual target-window and whole-display context for physical interaction.
11. Cross-app drag, clipboard file transfer, multi-display layout, PiP, and recording.
12. Bounded recovery instead of unbounded retry loops.

MacOS-Use is faster partly because it does not enforce most of these. Replacing Bimax with that model
would be a correctness and safety regression.

## Detailed findings

### P0. Bimax does not own its primary native hot path

Evidence:

- The staged artifact is the published CUA 0.12.3 binary.
- Native tree traversal, screenshot production, session semantics, and much input behavior are
  outside this repository.
- Hermes has to negotiate and work around CUA version differences; Bimax instead assumes its pinned
  tool contract.

Impact:

- Bimax can optimize around CUA but cannot optimize its hottest AX/capture implementation.
- The TypeScript layer accumulates reconciliation and compatibility logic.
- Driver upgrades are risky and capabilities can drift silently.

Decision:

- Build a Bimax-owned macOS native service.
- Keep CUA behind a `ComputerBackend` adapter until the native service passes parity gates.
- If CUA remains a supported backend, discover its tools, capabilities, input properties, and
  protocol version at startup as Hermes does.

### P0. The runtime is a god object with two native stacks

Evidence:

- `desktop.runtime.ts`: 6,658 lines.
- `helper.source.ts`: 1,254 lines of Swift embedded in a TypeScript string.
- The same runtime coordinates transport, app lifecycle, AX, capture, visual processing, target
  state, input, verification, recovery, PiP, recording, clipboard, layout, and Spaces.

Impact:

- Every change can alter unrelated invariants.
- Fallback and primary behavior can drift.
- Unit tests require large mocks and run slowly.
- Performance work becomes local patching rather than changing a clear pipeline.

Decision:

- Replace the file with versioned native services and small TypeScript orchestration modules.
- Compile and sign native code at build time, never from embedded source on first user action.

### P0. Full post-action evidence is the default for almost every action

Evidence:

- `postActionEvidence` refreshes the window, calls `observeTarget`, captures a screenshot, walks AX,
  reconciles the window, computes visual and semantic verification, and updates recovery state.
- It is called from click, type, key, set value, drag, scroll, open/focus, close/quit, clipboard
  operations, layout operations, and other acting paths.
- Bimax's handoff log measured 56 calls at mean 828 ms, with click around 1,700 ms and open around
  2,040 ms. It identifies roughly 1.5 seconds of post-action evidence as the dominant cost.

Impact:

- A cheap AX `setValue` or key event pays nearly the same evidence cost as a risky coordinate click.
- Multiple independent proof mechanisms run even when one authoritative semantic response is enough.
- End-to-end speed remains poor regardless of model latency.

Decision:

Use risk- and ambiguity-based evidence tiers:

| Tier | Use | Evidence |
|---|---|---|
| 0: delivery | hover, move, pointer positioning | native delivery receipt only |
| 1: semantic | AX press/set value/toggle/select | AX call result + target revision/event diff |
| 2: light | key/type/scroll in owned focused element | focused-target proof + bounded AX diff |
| 3: visual | raw coordinate click/drag, AX-silent UI | target screenshot region diff + AX diff |
| 4: full | send/purchase/delete/permission/security or ambiguous result | full target image + bounded AX snapshot + explicit postcondition |

Escalate upward when a lower tier cannot establish the effect. Do not weaken approval or target
ownership.

### P0. One primitive requires one assistant turn

Evidence:

- The ComputerTool prompt says “exactly ONE” action, “Never emit a second ComputerTool call,” and
  “one call = one action.”
- The agent loop defers additional computer calls.
- Codex's exposed workflow explicitly permits one or more actions followed by a state read.

Impact:

- Even a deterministic sequence such as focus field → replace text → press Return requires several
  model/tool round trips.
- Faster models cannot remove transport, prompt, inference, and state-injection latency between every
  primitive.
- Smaller models repeatedly reconstruct the same task and target context.

Decision:

Add a bounded native transaction:

```ts
type ComputerTransaction = {
  target: TargetRef;
  basedOn: SnapshotRef;
  actions: ComputerAction[];        // maximum 5
  stopOn: "target-change" | "ax-change" | "failure" | "always";
  observeAfter: "none" | "diff" | "image" | "full";
  expect?: Postcondition[];
};
```

The native service validates each action immediately before delivery and stops at the first
invalidated precondition. This is not blind batching. It is checked execution with a fresh snapshot
returned at the checkpoint.

Examples that should be one transaction:

- focus editable AX element → set value;
- select existing text → type replacement;
- click menu button → choose a menu item when both are exposed in one AX state transition;
- modifier down → click → modifier up;
- focus app/window → press one shortcut.

### P0. Perception is snapshot-heavy instead of event/diff-first

Evidence:

- Bimax's explicit observe and automatic post-action evidence both converge on `observeTarget`.
- The current CUA scan has measured near-linear cost: 50 nodes 22 ms, 100 nodes 56 ms, 200 nodes
  585 ms, 400 nodes 1,491 ms, 800 nodes 3,013 ms, and 2,000 nodes 6,125 ms on the measured app.
- Codex returns AX diffs by default.
- MacOS-Use proves that early/late batched AX attribute phases substantially reduce native IPC.

Impact:

- Bimax repeatedly pays for known, unchanged parts of the UI.
- Absence postconditions can trigger an exhaustive 2,000-node scan.
- Model context repeatedly receives redundant state.

Decision:

- Maintain a native AX graph per target window.
- Subscribe to AX notifications and emit revisions/diffs.
- Batch native attributes with `AXUIElementCopyMultipleAttributeValues`.
- Fetch early traversal fields for every node and late fields only for interactive/informative nodes.
- Return full state on first observation, explicit reset, event loss, or diff-base mismatch.
- Use a separate indexed text search over the cached graph for absence checks; do not rescan the
  application from the root for every absence postcondition.

### P0. Session state is global

Evidence:

- `globalDesktopRuntime` is a process singleton.
- `createComputerTool` defaults to that singleton and keeps `targetApp` in a closure.
- observations and actions are serialized through the same runtime because they mutate one global
  frame, element map, PiP geometry, and target.

Impact:

- Concurrent Bimax sessions can block one another.
- A late observation from one task can contend with another task's target.
- The physical input lock is correctly global, but semantic state and capture do not need to be.
- Target context may leak across conversations if tool instances share process lifetime.

Decision:

- Create one `ComputerSession` per agent/task.
- Give each session its own target, snapshots, token map, recovery state, expectations, and action
  history.
- Keep only the physical CGEvent arbiter and TCC/native service process machine-global.
- Make PiP and recording streams explicitly owned and reference-counted by session.

### P1. The model-facing contract is too broad and too nullable

Evidence:

- One action enum contains 34 public verbs.
- One schema exposes coordinates, semantic handles, source/destination variants, app/process/window,
  clipboard, display, recording, layout, expectation, and compatibility aliases together.
- The description contains a long mandatory loop and action reference.

Impact:

- Small models must select the right discriminator and ignore dozens of irrelevant fields.
- Compatibility aliases complicate validation and approval.
- Large tool prompts consume context on every task, even when only click/type/observe are needed.

Decision:

- Keep a single external namespace, but expose discriminated operations with action-specific schemas.
- Send only supported operations and fields for the current platform/backend.
- Put advanced window, recording, clipboard, and desktop management in separately discoverable
  capability groups.
- Return compact stable `TargetRef`, `SnapshotRef`, and `ElementRef` objects.
- Move verbose recipes out of the base schema.

### P1. Generic agent-loop policy contains app/task-specific rules

Evidence:

- Computer completion, messaging recipient, battery, and application-role rules are implemented in
  generic agent/core flow.
- Similar instructions also exist in the tool description and persona/playbook layers.

Impact:

- Multiple authorities can disagree about whether progress, completion, or another action is allowed.
- Rules intended to prevent one model failure affect every model and app.
- Prompt size grows while deterministic behavior remains scattered.

Decision:

- Keep generic runtime rules limited to safety, target ownership, action execution, and evidence.
- Move task completion into an `OutcomePolicy`.
- Move messaging recipient/send behavior into an optional recipe loaded only for messaging tasks.
- Move bundle-specific guidance into a registry keyed by bundle ID and inject it once per app.
- Ensure exactly one layer owns action batching and exactly one layer owns completion.

### P1. Bimax pays transport and payload tax for native state

Evidence:

- The primary path crosses TypeScript → MCP proxy → daemon → CUA and returns image data/structured
  content.
- Hermes needs a CLI fallback specifically when heavy MCP image payloads disappear.
- MacOS-Use's fastest reads are direct in-process calls.

Impact:

- PNG/base64 encoding, JSON parsing, and process hops add latency and memory pressure.
- Large image responses make transient bridge failure more likely.

Decision:

- Use XPC for the macOS service control plane.
- Return image file descriptors, mapped files, or IOSurface references rather than base64 in JSON.
- Keep snapshot metadata small and versioned.
- Encode/downscale only at the boundary where the model actually needs an image.

### P1. Browser automation is not part of the same semantic routing decision

Evidence:

- Bimax has a separate BrowserTool, while ComputerTool can still operate browser chrome and pages as
  generic desktop pixels/AX.
- Hermes exposes a typed browser route with tab/ref identity and browser-specific state.

Impact:

- The model can choose the slower, less reliable desktop path for web content.
- Page DOM semantics, dialogs, files, and downloads are lost when routed through pixels.

Decision:

- Add a routing layer above native computer use:
  - browser content → CDP/browser adapter;
  - browser chrome, extensions, permission sheets → macOS AX adapter;
  - AX-silent canvas/video → visual adapter.
- Preserve one task-level target model so browser and macOS surfaces can be composed safely.

### P1. Driver protocol is assumed rather than negotiated

Evidence:

- Bimax hardcodes a driver label/version and calls expected tool names.
- Hermes loads tool names, capabilities, input schemas, and capability-version metadata at startup.

Impact:

- A staged binary mismatch can fail only when a feature is used.
- Bimax cannot automatically expose new CUA features or disable unsupported ones.

Decision:

- Define a Bimax native protocol with explicit version negotiation.
- Add live discovery to the CUA adapter while it remains.
- Fail readiness/doctor checks at startup for incompatible required capabilities.

### P1. Current performance evidence is useful but incomplete

Existing measurements correctly identified:

- observe 3,252 ms → 1,132 ms median after scan-cap work;
- open 7,020 ms → 2,764 ms;
- frontmost lookup 642 ms through CUA versus 4 ms through native NSWorkspace;
- activation confirmation 810 ms → 33 ms;
- session switch p50 3,752 ms → 573 ms and p95 9,412 ms → 2,355 ms;
- PiP capture loop 56.8 fps median after removing the old cap;
- post-action evidence as the dominant action latency.

Gaps:

- No completed 30-minute soak.
- p95 app switch remains far over the stated 250 ms target.
- PiP can retain a window after the application replaces it.
- The benchmarks mix delivery, capture, model payload construction, and verification in ways that
  make regression ownership difficult.
- Existing PiP timing is capture-to-enqueue, not glass-to-glass.

Decision:

Instrument the new protocol with stage spans:

```text
request queue
target resolution
AX lookup/traversal
capture
input delivery
native settle/event wait
verification
image encode/map
IPC
model payload build
```

Report warm/cold and p50/p95/p99 by app class and evidence tier.

### P2. First-use Swift compilation is not a product-grade native deployment

Evidence:

- Embedded Swift is compiled with the user's `swiftc` on first use and cached under
  `~/.bimax/native`.

Impact:

- Xcode command-line tools become a runtime dependency.
- First-use latency and compilation failure are user-visible.
- TCC identity and code-signing behavior are harder to reason about.
- The embedded source string is difficult to develop, test, debug, and profile.

Decision:

- Move the helper into a Swift package/Xcode project.
- Build a universal signed artifact during release.
- Use one stable bundle/code-signing identity for Accessibility and Screen Recording permissions.

### P2. Current dirty worktree has a background-delivery regression

Evidence:

- Focused test failure expects no `bring_to_front` for background mode, but the runtime calls it.

Impact:

- Background operation can steal focus.
- It undermines the contract Bimax uses to distinguish semantic background delivery from physical
  foreground input.

Decision:

- Fix before benchmarking.
- Add an integration test that observes the real frontmost application throughout the transaction,
  not only a mocked driver call.

## Target architecture: macOS-native first

```text
Agent / model
  |
  | compact discriminated Computer API
  v
ComputerCoordinator (TypeScript)
  |- session registry
  |- task/outcome policy
  |- backend router
  |- browser/native/visual routing
  |
  +--> BrowserAdapter (CDP / existing BrowserTool)
  |
  +--> CuaCompatibilityAdapter (temporary and non-macOS)
  |
  +--> BimaxMacServiceClient (XPC)
          |
          v
      Bimax Computer Service (signed Swift)
        |- WorkspaceService: apps, processes, windows, displays
        |- AccessibilityService: AX graph, observers, typed actions, search
        |- CaptureService: ScreenCaptureKit, CGWindow, image surfaces
        |- InputService: CGEvent, targeted AX delivery, physical arbiter
        |- TargetService: exact ownership, z-order, frame revisions
        |- ClipboardService
        |- WindowService: layout, Spaces, fullscreen
        |- StreamService: PiP and recording
        |- ReceiptService: delivery/event/diff/visual proof
```

### Native service principles

1. One signed service with a stable TCC identity.
2. Long-lived AX objects, caches, observers, and capture streams.
3. Per-session logical state; global physical-input arbiter.
4. Versioned XPC protocol and capability discovery.
5. Full snapshot once, diff snapshots thereafter.
6. Typed AX actions before coordinates.
7. ScreenCaptureKit streams reused across observations.
8. Images transferred by handle, not base64.
9. Every action gets a receipt, but receipt cost is adaptive.
10. The service never contains model prompts, messaging policy, or task-completion rules.

### Proposed core protocol

```ts
type TargetRef = {
  sessionId: string;
  pid: number;
  windowId: number;
  targetRevision: number;
};

type SnapshotRef = {
  snapshotId: string;
  target: TargetRef;
  axRevision: number;
  pixelRevision?: number;
};

type ObserveRequest = {
  target: TargetRef;
  since?: SnapshotRef;
  mode: "ax" | "visual" | "som" | "dual";
  image: "none" | "region" | "window" | "display";
  maxElements?: number;
  query?: string;
};

type ActionReceipt = {
  actionId: string;
  delivered: boolean;
  recipient: TargetRef;
  path: "ax" | "targeted-event" | "physical-event";
  eventRevisionBefore: number;
  eventRevisionAfter: number;
  observed: "changed" | "no-change" | "rejected" | "indeterminate";
  confidence: "proven" | "supported" | "unknown";
  postconditions: PostconditionResult[];
  next?: SnapshotDelta;
};
```

### Perception policy

Default policy:

1. First observation: full pruned AX snapshot, no image unless AX is thin or task is visual.
2. Subsequent observation: AX diff from the session's snapshot revision.
3. Semantic action: action receipt plus bounded AX diff.
4. Coordinate action: preflight target pixels, deliver, return region/window visual diff.
5. High-impact action: full evidence and explicit postcondition.
6. Event loss, window replacement, or diff-base mismatch: reset and return a full snapshot.

Capture profiles:

| Profile | State | Intended use |
|---|---|---|
| `flash` | actionable AX diff, no screenshot | navigation, forms, menus, native apps |
| `balanced` | AX diff + target-region image | mixed native/visual UI |
| `visual` | scaled image + SOM, limited AX | canvas, games, remote desktops |
| `audit` | full AX + full window/display + postconditions | high-impact commits and debugging |

### AX control model to adopt

Use MacOS-Use's pattern idea, reimplemented in Swift:

- `Invoke`: press/click/default action;
- `Value`: read/set editable and selectable values;
- `RangeValue`: sliders, steppers, progress/range;
- `Toggle`: checkbox, radio, switch;
- `ExpandCollapse`: disclosure, tree, combo box;
- `Scroll`: scroll areas and direct AX scrolling;
- `Selection`: list/table/tab selection;
- `Text`: range lookup, selection, cursor placement, replacement;
- `Window`: raise, move, resize, minimize, fullscreen;
- generic `performSecondaryAction` using only actions advertised by the live AX element.

Each element token should bind:

```text
session + pid + window id + AX revision + stable path/fingerprint + native element reference
```

Do not bind it only to a model-visible array index.

## Proposed TypeScript decomposition

Replace the current runtime incrementally with:

```text
src/computer/
  coordinator.ts
  session.ts
  protocol.ts
  capabilities.ts
  backend.ts
  backends/
    macos.xpc.ts
    cua.ts
    linux.ts
  targeting/
    target.store.ts
    snapshot.store.ts
    element.refs.ts
    routing.ts
  actions/
    planner.ts
    transaction.ts
    impact.ts
  evidence/
    policy.ts
    receipt.ts
    postcondition.ts
    recovery.ts
  streams/
    pip.ts
    recording.ts
  recipes/
    registry.ts
```

Native project:

```text
native/macos/BimaxComputerKit/
  Package.swift
  Sources/
    Protocol/
    Workspace/
    Accessibility/
    Capture/
    Input/
    Targeting/
    Clipboard/
    WindowManagement/
    Streaming/
    Receipts/
  Tests/
    AXTraversalTests/
    TargetingTests/
    InputTests/
    ProtocolTests/
```

The existing TypeScript verification and targeting logic should initially move behind interfaces,
not be rewritten simultaneously. Port a behavior only after a parity test exists.

## Feature adoption plan

### Adopt first

From MacOS-Use:

- batched `AXUIElementCopyMultipleAttributeValues`;
- early/late two-phase tree traversal;
- aggressive role/visibility pruning;
- direct typed control patterns;
- AX-first no-screenshot default;
- concurrent collection for the target app and required system UI.

From Hermes:

- live capability and input-schema negotiation;
- per-session backend state;
- explicit AX/SOM/vision capture modes;
- optional post-action capture;
- element-token cache tied to snapshot;
- image dimension and JPEG quality controls;
- explicit delivery mode and separately approved foregrounding;
- doctor/readiness surface;
- typed browser route and exact browser refs.

From Codex's exposed contract:

- accessibility diffs by default;
- one or more checked actions before state refresh;
- first-class secondary AX actions;
- first-class text selection;
- state lookup that can resolve/start the app;
- app guidance injected only when relevant;
- safety policy separated from primitive implementation.

From current Bimax:

- all target/frame/recipient correctness guarantees;
- receipts, postconditions, recovery, and takeover;
- layout, multi-display, clipboard files, cross-app drag, PiP, and recording.

### Do not adopt

- MacOS-Use's unverified global coordinate actions.
- MacOS-Use's unrestricted shell escape as part of the computer-use runtime.
- Fixed sleeps for focus and typing.
- Hermes's compatibility wrapper shape as the new architecture.
- Regex parsing of accessibility tree text as a canonical protocol.
- Silent fallback from requested foreground/background semantics.
- Blind multi-action batching.
- App-specific completion logic inside the native service or generic agent loop.

## Migration plan

### Phase 0: freeze contracts and establish baselines — 1 week

- Fix the current background-focus regression.
- Complete the 30-minute soak and window-replacement PiP test.
- Record p50/p95/p99 spans for 10 representative apps:
  Finder, Notes, TextEdit, System Settings, Terminal, Safari/Chrome, Messages/WhatsApp,
  Electron app, document editor, and an AX-silent visual app.
- Separate model time from computer runtime time.
- Define a replayable task suite and action/receipt trace format.
- Establish wrong-target, stale-target, and duplicate-commit counters.

Exit gate:

- released baseline and dirty candidate measured using the same harness;
- no unexplained focus changes;
- no failing focused tests.

### Phase 1: create seams without behavior change — 1–2 weeks

- Introduce `ComputerBackend`, `ComputerSession`, `PerceptionPolicy`, and `EvidencePolicy`.
- Move the process-global target and snapshot data into per-session stores.
- Keep the existing runtime as the first backend.
- Separate global physical input arbitration from per-session observation.
- Move app/task-specific completion rules behind recipe/outcome interfaces.
- Add live capability discovery to the CUA adapter.

Exit gate:

- existing behavior and tests pass through the new interfaces;
- two concurrent read-only sessions do not overwrite each other's target/snapshot state.

### Phase 2: ship the signed macOS native service — 3–5 weeks

- Create the Swift package/XPC service.
- Implement workspace, permission status, app/window discovery, and target revisions.
- Implement batched two-phase AX snapshots and AX event observers.
- Implement typed AX press/set/toggle/expand/select/text actions.
- Implement ScreenCaptureKit window/display capture with shared image handles.
- Implement recipient preflight and physical CGEvent arbitration.
- Package and sign the service with Bimax.

Exit gate:

- native backend passes app/window/AX/permission parity;
- warm AX observation meets the performance budget;
- TCC permission survives update/relaunch under the stable signing identity.

### Phase 3: diff-first perception — 2–3 weeks

- Add full snapshot + incremental AX diff protocol.
- Add snapshot reset and event-loss recovery.
- Add native indexed text search and absence evaluation.
- Add capture profiles and image resizing/format controls.
- Reuse ScreenCaptureKit streams for PiP and action evidence.
- Replace JSON/base64 images with handles across the local IPC boundary.

Exit gate:

- diffs reconstruct exactly to the full AX graph in replay tests;
- event-loss injection always produces an explicit reset;
- model payload bytes drop by at least 60% on repetitive workflows.

### Phase 4: adaptive receipts and checked transactions — 2–3 weeks

- Implement evidence tiers 0–4.
- Implement bounded `actions[]` transactions with per-step preflight.
- Stop on target/AX invalidation and return the new diff.
- Preserve full evidence for raw coordinates and high-impact actions.
- Move recovery decisions to consume structured receipts rather than generic screenshots.

Exit gate:

- semantic form-entry tasks use at least 50% fewer model/tool turns;
- wrong-target and duplicate-commit safety tests remain at zero;
- full-evidence fallback activates on injected ambiguity.

### Phase 5: semantic browser routing — 2 weeks

- Integrate the existing BrowserTool through a common target/ref abstraction.
- Route page content to CDP, browser chrome to AX, and visual-only content to capture.
- Add typed dialog, upload, download, tab, and navigation outcomes.
- Preserve macOS ownership and user-visible approval for commits.

Exit gate:

- browser task suite no longer uses desktop pixels for ordinary DOM controls;
- browser chrome and system permission sheets still route correctly to macOS AX.

### Phase 6: cutover and remove duplicated paths — 1–2 weeks

- Make the native backend default on macOS.
- Keep CUA as a feature-flagged compatibility backend for one release cycle.
- Compare shadow receipts and snapshots during the rollout.
- Remove embedded Swift compilation after native parity.
- Reduce `desktop.runtime.ts` to adapters or delete it after cutover.

Exit gate:

- two stable releases without a native-backend rollback;
- no safety or correctness metric regression;
- CUA dependency removed from the default macOS package.

Estimated total: 11–16 engineering weeks, depending mainly on AX edge cases, code signing/TCC,
browser integration scope, and the number of engineers working in parallel.

## Performance budgets

Measure runtime only and end-to-end separately.

| Operation | p50 target | p95 target |
|---|---:|---:|
| Warm AX diff observe, no image | ≤80 ms | ≤200 ms |
| Warm full pruned AX snapshot | ≤180 ms | ≤450 ms |
| Window image + AX diff | ≤300 ms | ≤700 ms |
| Semantic AX action, delivery receipt | ≤100 ms | ≤250 ms |
| Light verified key/type/set-value | ≤250 ms | ≤600 ms |
| Raw physical click with region proof | ≤500 ms | ≤1,000 ms |
| Full high-impact verified action | ≤900 ms | ≤1,500 ms |
| App switch + minimal target state | ≤250 ms | ≤500 ms |
| Native service cold readiness | ≤700 ms | ≤1,500 ms |

Correctness budgets:

- zero wrong-window deliveries in target/occlusion stress tests;
- 100% stale snapshot refusal;
- zero orphaned held buttons after cancellation, crash, or takeover tests;
- zero silent foreground changes for background delivery;
- zero duplicate high-impact commits in retry/recovery tests;
- every diff either applies to its declared base or explicitly resets.

These targets should be enforced per app class. A pathological AX application must not hide
regressions in fast native apps, and fast apps must not make the aggregate look healthy.

## Test and benchmark matrix

### Native contract tests

- version/capability negotiation;
- invalid target and stale revision refusal;
- diff application and reset;
- element token lifecycle;
- action transaction stop conditions;
- receipt tier escalation;
- XPC disconnect/reconnect;
- image handle lifecycle and cleanup.

### macOS integration tests

- multiple windows from one process;
- modal sheets, menus, popovers, and transient windows;
- background AX action without focus theft;
- physical action with exact-recipient preflight;
- minimized, hidden, off-Space, and fullscreen windows;
- multiple displays with different scale factors;
- Secure Input and protected fields;
- AX-silent/canvas application fallback;
- app relaunch and window replacement;
- user takeover during drag and modifier hold;
- screen lock and TCC permission revocation.

### Safety regression tests

- stale coordinate after window move;
- occluding foreign window;
- same-process wrong window;
- target app quits between preflight and delivery;
- postcondition already true before action;
- send/submit retry after indeterminate receipt;
- cancellation between mouse-down and mouse-up;
- concurrent sessions targeting different apps.

### Performance tests

- cold and warm;
- AX-only, image-only, dual, and SOM;
- 50/100/200/500/1,000 element trees;
- full snapshot versus diff;
- semantic versus coordinate action;
- image handle versus encoded JSON payload;
- single action versus checked transaction;
- one, two, and four concurrent read-only sessions.

## Recommended execution order

The first engineering milestone should not be “add every missing feature.” It should be:

1. repair current background semantics;
2. measure the current pipeline with stage spans;
3. create per-session state and backend/evidence interfaces;
4. ship the signed native AX/workspace service;
5. add AX diffs and typed AX actions;
6. make verification adaptive;
7. add checked action transactions;
8. integrate typed browser routing;
9. migrate secondary features and remove duplicated native paths.

This order attacks the reasons Bimax is slow while keeping its strongest reliability work intact.

## Source extraction inventory

The audit traced these implementation files. They are the practical extraction set for a future
port; provider integrations, website documentation, and unrelated agent code are intentionally
excluded.

### Bimax source set

Core runtime and protocol:

- `src/computer/desktop.runtime.ts`
- `src/computer/helper.source.ts`
- `src/computer/transport.ts`
- `src/computer/action.contract.ts`
- `src/computer/action.evidence.ts`
- `src/computer/action.receipt.ts`
- `src/computer/coordinates.ts`
- `src/computer/frame.ts`
- `src/computer/input.executor.ts`
- `src/computer/semantic.targeting.ts`
- `src/computer/settle.ts`
- `src/computer/surface.ts`
- `src/computer/switch.ts`
- `src/computer/target.ts`
- `src/computer/verification.ts`
- `src/computer/visual.fingerprint.ts`
- `src/computer/recovery.ts`
- `src/computer/durability.ts`
- `src/computer/drag.ts`
- `src/computer/pip.ts`
- `src/computer/recording.ts`
- `src/computer/installed.apps.ts`
- `src/computer/phase.trace.ts`

Model and agent integration:

- `src/tools/implementations/computer.tool.ts`
- `src/core/agent.loop.ts`
- `src/mcp/computer.server.ts`

Packaging and performance:

- `scripts/stage-computer-use-driver.sh`
- `scripts/benchmark-computer-targeting.ts`
- `scripts/benchmark-computer-receipts.ts`
- `scripts/benchmark-computer-tasks.ts`
- `scripts/smoke-computer-all.ts`
- `scripts/soak-computer-use.ts`
- `scripts/verify-computer-receipt-live.ts`
- `scripts/verify-computer-use-live.ts`

### MacOS-Use source set

Native AX layer:

- `macos_use/ax/core.py`
- `macos_use/ax/controls.py`
- `macos_use/ax/patterns.py`
- `macos_use/ax/events.py`
- `macos_use/ax/enums.py`

Agent-facing desktop layer:

- `macos_use/agent/desktop/service.py`
- `macos_use/agent/desktop/views.py`
- `macos_use/agent/tree/service.py`
- `macos_use/agent/tree/config.py`
- `macos_use/agent/tree/views.py`
- `macos_use/agent/tools/service.py`
- `macos_use/agent/tools/views.py`
- `macos_use/agent/events/service.py`
- `macos_use/agent/watchdog/service.py`
- `macos_use/agent/loop.py`
- `macos_use/agent/service.py`
- `macos_use/agent/prompt/system.md`
- `macos_use/agent/prompt/system_flash.md`

### Hermes source set

- `tools/computer_use/backend.py`
- `tools/computer_use/cua_backend.py`
- `tools/computer_use/tool.py`
- `tools/computer_use/schema.py`
- `tools/computer_use/browser_route.py`
- `tools/computer_use/vision_routing.py`
- `tools/computer_use/doctor.py`
- `tools/computer_use/permissions.py`
- `apps/desktop/src/app/settings/computer-use-panel.tsx`
- `tests/computer_use/*`
- `tests/tools/test_computer_use*.py`

### Codex source and installed-contract set

Open-source integration points:

- `codex-rs/features/src/lib.rs`
- `codex-rs/core-plugins/src/discoverable.rs`
- `codex-rs/config/src/config_requirements.rs`
- `codex-rs/app-server/src/request_processors/config_processor.rs`
- `codex-rs/app-server/src/request_processors/thread_processor.rs`

Locally installed proprietary plugin contract:

- `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000550/plugin.json`
- `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000550/scripts/computer-use-client.mjs`
- `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000550/skills/computer-use/SKILL.md`
- launcher for `SkyComputerUseClient`

No reference code was vendored into Bimax during this audit. The first implementation phase should
port only the selected patterns behind the proposed interfaces, with attribution and license review,
rather than copying whole wrappers.

## Licensing note

- Codex repository code is Apache-2.0, but the installed bundled computer-use implementation is
  proprietary; use its public contract as inspiration, not its private binaries or source.
- Hermes is MIT-licensed.
- MacOS-Use declares MIT in `pyproject.toml` and README, though this checkout does not contain a
  top-level license file. Confirm and preserve upstream notice before copying substantial code.
- Prefer reimplementing the architecture in Swift so Bimax owns the macOS runtime and can optimize,
  sign, test, and ship it coherently.

## Final recommendation

Do not keep expanding the present TypeScript wrapper and do not wholesale replace it with Hermes or
MacOS-Use.

Build a Bimax macOS native service, retain CUA only as a migration/non-macOS adapter, and make the
default loop:

```text
full AX state once
  -> checked semantic action transaction
  -> native event/AX diff receipt
  -> screenshot only on visual need, ambiguity, raw coordinates, or high impact
```

That is the path to getting the best capability and speed from all three references without
discarding the correctness properties Bimax has already built.
