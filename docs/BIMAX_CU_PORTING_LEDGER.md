# Bimax-Cu upstream porting ledger

Status: active

Purpose: record every substantial copied, translated, or behavior-derived computer-use unit.

## Rules

1. Add an entry before merging a port.
2. Use an exact upstream commit and file.
3. Record the license and required notice.
4. Distinguish copied code, translated code, and behavior-only reimplementation.
5. Link destination code and parity/security tests once implemented.
6. Do not import upstream telemetry, unrestricted command execution, or model orchestration.
7. Codex proprietary computer-use artifacts are behavior references only.

## Port types

| Type | Meaning |
|---|---|
| `copy` | Substantial source text retained |
| `translate` | Source algorithm/control flow ported across languages |
| `behavior` | Public behavior independently implemented |
| `idea` | General architecture pattern with no substantial source expression copied |
| `reject` | Reviewed but deliberately not adopted |

## Upstream baselines

| ID | Repository | Commit/version | License posture |
|---|---|---|---|
| `MU` | `/Users/vishsiddharth/Desktop/MacOS-Use` | `c88574c0a70534a21e9490e2118f1fce04e16904` | MIT declared in README/pyproject |
| `HE` | `/Users/vishsiddharth/Desktop/hermes-agent` | `ce6dd1a65f4b6b20b1f3b31f75184a3e26583488` | MIT |
| `CX` | `/Users/vishsiddharth/Desktop/codex` | `53d06e24ea318a963812030fa8fed1bd0fc42d42` | Apache-2.0 integration code |
| `CXP` | local Codex plugin | `1.0.1000550` | proprietary; contract observation only |
| `BX` | current Bimax | `598c71effcecc018cc710c487feeb2314400b770` plus worktree | Bimax-owned |

The upstream MIT text was recovered from the local repository's first commit
`c2af5b9c53e28313275fae12a9644486ff1a091c` and is retained in `THIRD_PARTY_NOTICES.md`.

## MacOS-Use candidate ports

| ID | Feature | Upstream file | Port type | Destination | Priority | State |
|---|---|---|---|---|---|---|
| `MU-001` | Multiple AX attribute read wrapper | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — typed Swift batch wrapper with per-value AX error filtering |
| `MU-002` | Early traversal attribute batch | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — bounded Phase 3 slice |
| `MU-003` | Late interactive attribute batch | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — only emitted candidates pay metadata/action cost |
| `MU-004` | Rectangle parsing/intersection | `macos_use/ax/core.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — exact-window intersection with off-window pruning |
| `MU-005` | AX action enumeration/execution | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — allowlisted exact-window primitives only |
| `MU-006` | AX attribute settable/set value | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — bounded typed AXValue writes; secure fields rejected |
| `MU-007` | Element-at-position and PID ownership | `macos_use/ax/core.py` | behavior | compatibility `ComputerTool` recipient grounding; native migration in Phase 9 | P0 | preserved — mature compatibility path remains the sole global-pointer owner; semantic opt-in cannot claim or emit physical input |
| `MU-008` | Per-application AX messaging timeout | `macos_use/ax/core.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — 500 ms native calls plus capture budget/partial diagnostics |
| `MU-009` | Display bounds and DPI data | `macos_use/ax/core.py` | behavior | `native/BimaxComputerUseKit/.../WorkspaceInventory.swift` | P0 | completed — independent Swift implementation; logical/pixel geometry tested |
| `MU-010` | Unicode typing/key mapping | `macos_use/ax/core.py` | behavior | `TargetedKeyboardInput.swift` plus compatibility global-key path | P0 | completed for targeted Unicode typing; global key chords remain compatibility-owned until full cutover |
| `MU-011` | Running/frontmost app lookup | `macos_use/ax/core.py` | behavior | `native/BimaxComputerUseKit/.../WorkspaceInventory.swift` | P0 | completed — NSWorkspace inventory + WindowServer focus behavior |
| `MU-012` | App resolve/launch/open file/open URL | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../AppWorkspace.swift`, `FileWorkspace.swift` | P1 | completed — resolve, non-activating launch, and non-activating open-file are live-verified; open-URL is scheme-restricted to http/https and remains advertised-but-unverified |
| `MU-013` | Finder reveal/Trash/duplicate helpers | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../FileWorkspace.swift` | P1 | completed — trash reports where the item landed; duplicate is collision-safe; reveal is declared foreground-changing and stays unverified |
| `MU-014` | File metadata/icon/UTI helpers | `macos_use/ax/core.py` | translate | `native/BimaxComputerUseKit/.../FileWorkspace.swift` | P2 | completed for metadata/UTI/package/default handler; icon bitmaps rejected — a capability-negotiated protocol has no use for an NSImage, and the capture engine already owns pixels |
| `MU-015` | Wallpaper get/set | `macos_use/ax/core.py` | behavior | none | P2 | rejected — unrelated persistent desktop mutation with no Bimax product requirement; not advertised |
| `MU-016` | Base control wrapper | `macos_use/ax/controls.py` | reject | per-element capability data | P0 | rejected — a per-role class hierarchy is a Python ergonomic, not a protocol need |
| `MU-017` | Application/window controls | `macos_use/ax/controls.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — window pattern exposed as node capability data; per-role classes rejected |
| `MU-018` | Button/check/radio/toggle controls | `macos_use/ax/controls.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — invoke/toggle/select plus classified capabilities |
| `MU-019` | Text field/area controls | `macos_use/ax/controls.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — bounded set-value plus range/exact-text/caret selection |
| `MU-020` | Combo/popup/slider controls | `macos_use/ax/controls.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — value and range primitives plus classification |
| `MU-021` | Menu/tab controls | `macos_use/ax/controls.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P1 | completed — press-based selection plus classification |
| `MU-022` | List/table/outline/row/cell controls | `macos_use/ax/controls.py` | behavior | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P1 | completed — explicit item selection, atomic container multi-select, and `scroll_to_visible` addressing |
| `MU-023` | Scroll area control | `macos_use/ax/controls.py` | translate | `native/BimaxComputerUseKit/.../AXTextScrollPatterns.swift` | P0 | completed — scrollbar position reads as page-scroll evidence |
| `MU-024` | Link/image/web area/static text | `macos_use/ax/controls.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P1 | completed — capability data per node; AXWebArea text markers deliberately out of scope |
| `MU-025` | Disclosure and dock controls | `macos_use/ax/controls.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P1 | completed — expand/collapse and dock roles classified from live attributes |
| `MU-026` | Invoke pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — live action-name validation plus AXPress |
| `MU-027` | Value/range patterns | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — set-value and increment/decrement subset |
| `MU-028` | Toggle pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — role-gated AXPress |
| `MU-029` | Expand/collapse pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — live state/no-op receipt plus AXPress |
| `MU-030` | Scroll pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXTextScrollPatterns.swift` | P0 | completed — advertised-action page scrolling in four directions |
| `MU-031` | Selection pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXSemanticActionEngine.swift` | P0 | completed — single-item `AXSelected` plus atomic container-level multi-select |
| `MU-032` | Window pattern | `macos_use/ax/patterns.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift`, `WindowOperations.swift` | P1 | completed — discovery stays on the node; mutation landed as a governed workspace operation with move/resize/set-frame live-verified and minimize/unminimize/close measured inert or flaky |
| `MU-033` | Text pattern | `macos_use/ax/patterns.py` | translate | `native/BimaxComputerUseKit/.../AXTextScrollPatterns.swift` | P0 | completed — bounded range/match/caret selection; text markers deferred |
| `MU-034` | Per-app AXObserver lifecycle | `macos_use/ax/events.py` | translate | `native/BimaxComputerUseKit/.../AXEventTracker.swift` | P0 | completed — bounded session/PID observer ownership and teardown |
| `MU-035` | Focus/structure/property notification sets | `macos_use/ax/events.py` | translate | `native/BimaxComputerUseKit/.../AXEventTracker.swift` | P0 | completed — app notifications plus focused-control subscriptions |
| `MU-036` | Observer debounce/dispatch | `macos_use/ax/events.py` | behavior | `AXEventTracker.swift` | P0 | completed — bounded per-session observers and monotonic dirty epochs drive diffs; an unsolicited external event stream is rejected because no model/tool consumer exists |
| `MU-037` | Interactive/container/prunable role sets | `macos_use/agent/tree/config.py` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — measured flash/balanced/audit pruning and capability classification |
| `MU-038` | Iterative pruned tree traversal | `macos_use/agent/tree/service.py` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — bounded exact-window full/diff traversal landed |
| `MU-039` | Window clipping | `macos_use/agent/tree/service.py` | behavior | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P0 | completed — clipped bounds and fully off-window subtree removal |
| `MU-040` | Parallel target/system traversal | `macos_use/agent/tree/service.py` | behavior | `NativeToolCoordinator.observeParallel` | P1 | completed — 1–4 ordered reads use independent signed bridges against one task session; bounded, fail-closed, and disposable |
| `MU-041` | Browser/desktop correction concepts | `macos_use/agent/tree/service.py` | behavior | `AccessibilityEngine.correctedLabel` | P1 | completed — bounded label enrichment for window controls, links, cells, and groups; unsafe child-role/ref substitution rejected |
| `MU-042` | No-vision/default state mode | `macos_use/agent/desktop/service.py` | idea | `native.profile.router.ts` | P0 | completed — handshake/evidence-aware AX-only flash/balanced modes remain available without model vision |
| `MU-043` | Annotated screenshots | `macos_use/agent/desktop/service.py` | translate | `native/BimaxComputerUseKit/.../CaptureGeometry.swift`, `SOMRenderer.swift`, `SOMCaptureComposer.swift` | P1 | completed — authoritative typed image/SOM/zoom delivery; live fixture capture produced complete frames |
| `MU-044` | Multi-select | `macos_use/agent/tools/service.py` | behavior | native semantic transaction | P1 | completed — element refs and atomic selected-row array, no coordinate/control-click port |
| `MU-045` | Multi-edit | `macos_use/agent/tools/service.py` | behavior | native semantic transaction | P1 | completed — bounded checked `set_value` sequence with partial receipt |
| `MU-046` | Spaces UI operations | `macos_use/agent/tools/service.py` and desktop service | behavior | `SpacesDisplays/Spaces.swift` | P1 | **blocked, measured** — switch/create/remove need either private CoreGraphics Spaces calls (forbidden) or Mission Control keyboard automation through the still-unimplemented global CGEvent stream; "on another Space" is not answerable from the public window list (103 layer-0 windows, 4 on-screen, 0 of the other 99 on another Space). Displays and usable bounds landed instead. **There is no upstream implementation to port.** At `c88574c0`, `desktop_tool` calls `desktop.manage_spaces(...)`, and `_Desktop` defines no such method; the call raises and the tool returns the exception as text. The documented create/remove/switch behavior is a docstring, not code |
| `MU-047` | AX page scrape fallback | `macos_use/agent/tools/service.py` | behavior | `src/computer/browser.convergence.route.ts` + ComputerTool handoff | P1 | completed — read-only WebArea fallback, exact PID, short-lived task authority; compatibility backend reported honestly |
| `MU-048` | Loop repetition/stagnation/cycle fingerprints | `macos_use/agent/loop.py` | behavior | `failure.memory.ts`, `loop-detector.ts`, `computer/recovery.ts` | P0 | completed — normalized action/state fingerprints, class budgets, cycle detection, and bounded recover/escalate/stop decisions |
| `MU-049` | File-based memory tool | `macos_use/agent/tools/service.py` | reject | existing Bimax memory | — | rejected |
| `MU-050` | Arbitrary shell/AppleScript tool | `macos_use/agent/tools/service.py` | reject | existing governed tools | — | rejected |
| `MU-051` | PostHog telemetry | `macos_use/telemetry/*` | reject | none | — | rejected |
| `MU-052` | System UI bundle allowlist | `macos_use/agent/desktop/config.py` | behavior | `native/BimaxComputerUseKit/.../ServiceCore.swift` | P0 | completed — scope-enforced Dock/Control Center/SystemUIServer/Spotlight set |
| `MU-053` | `AXTitleUIElement` sibling-label dereference | `macos_use/agent/tree/service.py:365`, `:384–390` | translate | `native/BimaxComputerUseKit/.../AccessibilityEngine.swift` | P1 | completed — bounded Title/Value/Description read; original element keeps action authority; opt-in live fixture proof |
| `MU-054` | Flash GUI prompt for small models | `macos_use/agent/prompt/system_flash.md` | idea | `src/cli/personas/computer.playbook.ts` | P1 | completed — compact observe/act/verify playbook selected for ≤14B models; exact-state compiler and evidence gates are Bimax additions |

## Hermes candidate ports

| ID | Feature | Upstream file | Port type | Destination | Priority | State |
|---|---|---|---|---|---|---|
| `HE-001` | Backend result types | `tools/computer_use/backend.py` | behavior | `src/computer/backend.ts` | P0 | in progress — legacy command/result envelope retained during compatibility phase |
| `HE-002` | Per-session backend cache | `tools/computer_use/tool.py` | behavior | `src/computer/session.manager.ts` | P0 | completed — independent implementation; isolation/concurrency tests added |
| `HE-003` | Capability discovery from live schema | `tools/computer_use/cua_backend.py` | behavior | `src/computer/cua.compat.backend.ts` | P0 | completed — independently implemented from live runtime status + owned action contract |
| `HE-004` | Dead transport/session revival | `tools/computer_use/cua_backend.py` | behavior | `computer/transport.ts`, native bridge retry policy | P0 | completed — retired compatibility sessions revive once; native bridge retries only read-safe requests and never replays mutations |
| `HE-005` | Snapshot index-to-token map | `tools/computer_use/cua_backend.py` | behavior | `AXSnapshotStore.swift` + `ElementRef` | P0 | completed — bounded task-local refs and stale invalidation |
| `HE-006` | AX/SOM/vision capture contract | `tools/computer_use/schema.py` | behavior | perception profiles | P0 | completed — native typed AX/image/SOM/zoom modes, handshake-derived schemas, measured routing, and live complete-frame proof |
| `HE-007` | Optional capture-after | `tools/computer_use/tool.py` | behavior | receipt evidence policy | P0 | completed — native actions support bounded postconditions/adaptive evidence; compatibility physical actions retain fresh post-action capture |
| `HE-008` | Element response caps | `tools/computer_use/tool.py` | behavior | observation budgets | P0 | completed — schema and service enforce 1–2000, with separate traversal/diff ceilings |
| `HE-009` | Image dimension/JPEG/zoom controls | `tools/computer_use/tool.py`, `cua_backend.py` | behavior | `native/BimaxComputerUseKit/.../CaptureImageEncoder.swift`, `ServiceCore.swift` | P1 | completed — typed bounded JPEG/PNG and zoom-to-rect, now behind live-proven capture capability |
| `HE-010` | Background/foreground contract | `tools/computer_use/schema.py` | behavior | `src/computer/delivery.policy.ts` | P0 | completed — independently implemented; background evidence cannot acquire focus |
| `HE-011` | Explicit bring-to-front refusal | `tools/computer_use/cua_backend.py` | behavior | focus lease | P0 | completed — background policies cannot acquire focus; foreground policies require brokered exact-PID leases and live restoration proof |
| `HE-012` | Typed browser backend interface | `tools/computer_use/backend.py` | behavior | BrowserRuntime/ComputerTool adapter | P1 | completed — explicit page/chrome/system surfaces and cross-tool handoff contract |
| `HE-013` | Typed browser route | `tools/computer_use/browser_route.py` | behavior | `src/computer/browser.convergence.route.ts` | P1 | completed — exact typed targets, backend/path receipts, blockers, expiry and task binding |
| `HE-014` | Permission probe | `tools/computer_use/permissions.py` | behavior | PermissionDoctor | P0 | completed — native read-only TCC/signing probes |
| `HE-015` | Doctor report | `tools/computer_use/doctor.py` | behavior | `/computer` native-service status | P0 | completed — capability/TCC/signing summary |
| `HE-016` | Zoom | `tools/computer_use/cua_backend.py` | behavior | CaptureEngine | P1 | completed — bounded authoritative region transform, encoding, and live base-capture gate |
| `HE-017` | Agent cursor config/state | `tools/computer_use/cua_backend.py` | behavior | overlay/streams | P2 | in progress — task-owned config/state contract landed; native overlay capability remains explicitly false |
| `HE-018` | Recording ownership | `tools/computer_use/cua_backend.py` | behavior | compatibility session backend + native stream pool | P1 | completed at product boundary — explicit opt-in, task-owned bounded storage, safe PiP, and live native frames; transport migration is a Phase 9 cutover concern |
| `HE-019` | Trajectory replay modes | `tools/computer_use/cua_backend.py` | behavior | product feature policy | P1 | completed — bounded task-owned trajectory plus dry-run/validate/live approval+executor contract; native handshake remains honest until a service executor ships |
| `HE-020` | MCP/CLI heavy result fallback | `tools/computer_use/cua_backend.py` | behavior | image handles and read-only MCP result shaping | temporary | completed — heavy pixels remain native handles; MCP never exposes private display-approval tokens |

## Codex exposed-contract references

These entries are behavior/idea only. No proprietary implementation is copied.

| ID | Feature | Observed contract | Port type | Destination | State |
|---|---|---|---|---|---|
| `CXP-001` | Default AX diffs | `get_app_state(disableDiff?)` | behavior | `AXSnapshotStore.swift` | completed — independent typed implementation |
| `CXP-002` | Multiple actions before state read | plugin skill workflow | behavior | transactions | completed for bounded Phase 4 semantic subset |
| `CXP-003` | Secondary AX action | `perform_secondary_action` | behavior | SemanticActions | completed — payload-free `AXShowMenu`, live-performed by the fixture and included in the verified catalog |
| `CXP-004` | Text selection | `select_text` | behavior | `AXTextScrollPatterns.swift` | completed — exact text with prefix/suffix disambiguation; ambiguity refused |
| `CXP-005` | Background app resolution/launch | `get_app_state` behavior | behavior | AppWorkspace | completed for resolution and non-activating launch; implicit launch inside an observation is deliberately not adopted |
| `CXP-006` | Adaptive settle | plugin skill contract | behavior | ReceiptEngine | completed — event-first bounded settling with postcondition evidence and timeout receipts |
| `CXP-007` | App-specific guidance | plugin skill contract | idea | app profiles | completed — exact-bundle registry, bounded declarative recipes, once-per-bundle-per-task delivery |
| `CXP-008` | Persistent frozen client | wrapper contract | idea | service/session manager | completed — long-lived signed bridge and task/native session coalescing; parallel reads use bounded auxiliary bridges |

## Bimax migrations

| ID | Current source | Destination | Port type | State |
|---|---|---|---|---|
| `BX-001` | `src/computer/target.ts` | TS target store/native Targeting | translate | planned |
| `BX-002` | `src/computer/frame.ts` | SnapshotRef compatibility | translate | planned |
| `BX-003` | `src/computer/semantic.targeting.ts` | TS/native element matching | translate | planned |
| `BX-004` | `src/computer/input.executor.ts` | global PhysicalInputArbiter | translate | planned |
| `BX-005` | `src/computer/verification.ts` | Evidence/Postconditions | translate | planned |
| `BX-006` | `src/computer/recovery.ts` | TS recovery policy | translate | planned |
| `BX-007` | `src/computer/visual.fingerprint.ts` | CaptureEngine visual proof | translate | planned |
| `BX-008` | `src/computer/pip.ts` and `native/BimaxLivePip.swift` | StreamsRecording | translate | completed at product boundary — capture pool and PiP are live; native presentation migration is Phase 9 |
| `BX-009` | `src/computer/recording.ts` | StreamsRecording | translate | completed at product boundary — bounded recording/trajectory/replay policy; native video writer remains capability-false during migration |
| `BX-010` | `src/computer/helper.source.ts` | Swift package modules | translate | planned |
| `BX-011` | `src/computer/transport.ts` | CUA compatibility adapter | translate | planned |
| `BX-012` | `src/computer/desktop.runtime.ts` | coordinator/backends/native service | decompose | in progress |
| `BX-013` | agent-loop task-specific gates | recipes/outcome policies | decompose | planned |
| `BX-014` | `ComputerTool` schema | compatibility adapter/new operations | decompose | planned |

## Implemented entries

### `BX-008` / `HE-018`: bounded ScreenCaptureKit stream pool

Date: 2026-08-01

Reused Bimax source:

- `native/BimaxLivePip.swift`: exact window lookup, desktop-independent window filter,
  `SCStreamConfiguration`, 60 Hz ceiling, queue depth 3, BGRA frames, complete/idle frame
  classification, and start/stop lifecycle.

Bimax-Cu implementation:

- `ScreenCaptureKitStreamDriver.swift` extracts that lifecycle without the presentation panel;
- `CaptureStreamPool.swift` adds exact window/display keys, bounded leases, warm idle reuse,
  least-recently-used idle eviction, refusal when every stream is leased, deterministic teardown,
  and per-stream frame statistics;
- `scripts/conformance-bimax-cu-capture.sh` launches only the inert fixture and requires a complete
  nonzero frame;
- the repeated live gate produced four complete 1120×976 frames with no idle-frame substitution;
- handshake `regionCapture`, `som`, and `zoom` are true. `streams` remains false because the wire
  protocol still exposes bounded image handles rather than an external continuous stream.

Tests: shared leases, warm reuse, statistics routing, forged leases, capacity refusal, deterministic
LRU eviction, full reset teardown, and the production service build.

### Phase 5 internal image handles

Date: 2026-08-01

Reused Bimax pattern:

- `AXSnapshotStore.swift` session ownership, random authority handles, bounded retention, eviction,
  exact descriptor validation, and synchronous reset.

Bimax-Cu implementation:

- `ImageHandleStore.swift` retains raw image bytes only inside the trusted service and exposes an
  immutable descriptor with format, dimensions, byte count, SHA-256, creation time, and random
  session-bound token;
- explicit crop/scale transforms map model image pixels back to full-resolution source pixels;
- byte and handle caps evict oldest images; cross-session, evicted, forged, and reset handles fail
  closed;
- no wire operation or capture capability is advertised by this internal slice.

Tests: transform round-trip/bounds, digest metadata, session isolation, byte/handle eviction,
descriptor forgery, and reset.

Wire follow-up (slice 4):

- `capture.image` accepts an exact generation-bound `WindowRef` or a named display, optional
  top-left pixel region, format, longest-edge limit, and JPEG quality;
- the JSON control response contains immutable `ImageHandleRef` metadata only—never image bytes;
- `BimaxCuXPCProtocol.readImage` is a separate raw `Data` channel, so redemption does not expand
  the image into JSON/base64;
- handles are bound to their trusted session and full descriptor/transform; cross-session,
  stale-window, forged-transform, released, and reset handles fail closed;
- `image.release`, session reset, and session close synchronously discard retained bytes;
- the production provider uses a one-shot bounded ScreenCaptureKit pool and tears it down before
  returning. Continuous stream ownership is not implied and `streams` remains false.

Tests: Codable capture/release operations, exact window-generation preflight, display requests,
raw non-UTF-8 XPC byte preservation, session isolation, transform forgery, release, reset, and
provider cancellation routing.

### `HE-009`: bounded model image encoding

Date: 2026-08-01

Translated/reused source:

- `/Users/vishsiddharth/Desktop/hermes-agent/tools/computer_use/tool.py`, pinned at
  `ce6dd1a65f4b6b20b1f3b31f75184a3e26583488`: 1,456-pixel longest-edge model image cap and no
  upscaling;
- MacOS-Use `desktop/service.py`: precision PNG and bounded screenshot scaling;
- Bimax `src/computer/helper.source.ts`: sRGB-normalized CoreGraphics bitmap rendering.

Bimax-Cu implementation:

- `CaptureImageEncoder.swift` performs validated top-left crops, aspect-preserving scaling, sRGB
  rendering, precision PNG, and vision JPEG at the requested quality (default 0.85);
- every encoded result carries the exact crop/scale transform and can be retained directly by
  `ImageHandleStore`;
- `ScreenCaptureKitStreamDriver` retains only its newest complete sample and encodes it on demand,
  so static streams do not repeatedly pay image encoding cost;
- invalid limits, quality, and crop bounds fail closed.

Tests: real PNG/JPEG encode/decode, signature/dimension checks, visual top-row crop orientation,
model scaling, transform retention, and invalid input rejection.

Zoom follow-up (slice 6):

- behavior reference: Hermes `tools/computer_use/cua_backend.py:zoom`, pinned at
  `ce6dd1a65f4b6b20b1f3b31f75184a3e26583488`, which declares an exact window ID, top-left
  rectangle, scale factor, format, and quality;
- capture mode `zoom` requires an exact generation-bound window and a positive source-pixel region;
- the factor is bounded to `(0, 8]` and then clamped by the existing final `maxDimension`, so a
  request cannot create an unbounded bitmap;
- the image handle reports the original source rectangle and exact final dimensions; zoom does not
  invent AX/SOM mark authority;
- missing regions, display targets, out-of-range factors, and zoom factors attached to plain image
  captures fail before the provider runs;
- the handshake's `zoom` flag remains false because the permissioned production ScreenCaptureKit
  gate returned only suspended frames.

Tests: zoom wire round-trip, real crop/upscale encoding, raw handle redemption, transform accuracy,
max-dimension interaction, and provider preflight refusals.

### Phase 6 slice 1: operation-specific capability schemas

Date: 2026-08-01

Behavior reference: Hermes `tools/computer_use/schema.py` uses an action discriminator and explicit
capture modes; Bimax splits that catalog by authority boundary so observation, semantic mutation,
checked transactions, and capture do not share one argument soup.

Bimax implementation:

- `native.operation.contract.ts` derives workspace, observe, action, transaction, and capture JSON
  schemas from one validated `bimax.cu.v1` handshake;
- action and delivery-policy enums use only verified values that are also advertised;
- the checked transaction schema appears only when both `set_value` and `set_selected`, an allowed
  background policy, and the transaction capability are all verified;
- image/SOM/zoom modes appear independently from their live capability flags. The current suspended
  capture gate therefore produces no `BimaxCaptureTool` contract;
- these contracts are inactive until native transport/cutover work lands; the compatibility
  `ComputerTool` remains the production surface.

Tests: missing handshake, verified-vs-advertised filtering, partial transaction refusal, per-mode
capture gating, transaction step cap, and absence of foreground policies not proven live.

### Phase 6 slice 2: checked transaction compiler and approval manifest

Date: 2026-08-01

Reused Bimax contracts:

- master-plan §15: expand resolved target, delivery path, impact, entered data, commit boundary,
  and required evidence before execution;
- `WireProtocol.swift:SemanticTransactionRequest`: SHA-256 over the sorted-key
  `basedOnSnapshotId`/`steps`/`deliveryPolicy` payload, recomputed by the native service;
- the Phase 4 native service's bounded transaction authority: 1–5 steps, one retained snapshot,
  one exact generation-bound window, and only `set_value`/`set_selected` over verified background
  policies.

Bimax implementation:

- `native.transaction.compiler.ts` is pure and transport-free. It is the only coordinator path
  that creates `approvalManifestHash`;
- complete `ElementRef`s, safe integer target identities, typed finite values, optional allowlisted
  preconditions, unique step IDs, one snapshot, and one exact window are checked before a wire
  request exists;
- the compiler intersects advertised and live-verified actions/policies and honors the measured
  step limit, capped at the native service's five-step contract;
- the expanded approval view repeats the exact entered data and resolved target bound by the hash,
  and labels every accepted step routine, non-commit, semantic-evidence work;
- any unknown field or verb outside `set_value`/`set_selected` is refused before hashing. Submit,
  send, purchase, delete, grant, permission, authentication, upload/download, install, and settings
  mutations therefore cannot be hidden inside a routine transaction; they remain separately
  governed commit actions;
- the wire request and its separately cloned approval view are recursively frozen after expansion;
- Swift and TypeScript independently assert the same slash/unicode sorted-key vector
  (`17c667538c791fe90c92b6958f31458eabb72557d9cc8ce1ebd25a4db8bccf6a`) so encoder drift fails CI.

Tests: exact binding, expanded manifest, tamper-sensitive hash, mixed snapshot/window refusal,
duplicate IDs, typed-value shape, measured step cap, partial capability refusal, commit-action
refusal, hidden-field refusal, and cross-language hash parity. Native foundation: 51/51.

### Phase 6 slice 3: measured perception-profile routing

Date: 2026-08-01

Reused Bimax source:

- master-plan §9: text-only → `flash`, strong-tool vision → `balanced`, coordinate-grounded vision
  → `som`/`vision`, high-impact → `audit`, AX-silent and repeated-grounding failures → visual
  escalation;
- `src/core/capabilities.ts`: `visionInput` and `parallelToolCalls` are the existing conservative
  model capability signals; coordinate grounding remains an explicit opt-in rather than an
  inference from a model name;
- the native handshake remains the only authority for profiles and capture/SOM/stream support.

Bimax implementation:

- `native.profile.router.ts` returns the desired profile, the actually selected profile, the
  ordered candidates, safety-escalation state, and typed blockers;
- `flash` and `balanced` may route through AX-only observation because images are absent/optional
  by contract. A missing `balanced` profile may fall back to `flash` without inventing evidence;
- `vision`, `som`, `audit`, and `stream` require both an advertised profile and their independent
  live capability flags. Visual model input is also required where model-visible pixels are the
  purpose of the route;
- high-impact commits require `audit` and have no weaker fallback. AX-silent targets and repeated
  grounding failures escalate past explicit `flash`/`balanced` requests and block native routing
  if no visual route is proven;
- on the current handshake, text-only and strong-tool semantic work selects `flash`/`balanced`,
  while coordinate, visual-recovery, SOM, stream, and audit work stays native-ineligible because
  the live capture gate remains suspended.

Tests: text/vision defaults, AX-only balanced behavior, suspended-capture refusal, explicit visual
requests, AX-silent escalation, repeated-grounding escalation, high-impact audit with no downgrade,
advertisement/flag consistency, and malformed model capability refusal.

Transport state at the end of slice 3: the existing `BimaxCuXPCClient` was Data-only and
signature-checking, but the
Electron/engine host still lacks a packaged signed bridge into that client. Slice 3 deliberately
does not add a direct stdio service mode because that would bypass the service's XPC audit-token
and code-signing checks. Executable native transport wiring remains pending.

### Phase 6 slice 4: signed XPC bridge and coordinator transport

Date: 2026-08-01

Reused Bimax source:

- `BimaxCuXPCClient`: typed Codable envelopes over a Data-only XPC interface, read-only reconnect
  only, and no implicit mutation replay;
- the existing Electron focus broker pattern: a privileged native deputy must be authorized by
  app-owned state rather than becoming an ambient executable endpoint;
- `native.service.client.ts`: every handshake is validated and cutover eligibility is recomputed
  from measured capabilities rather than trusted from environment flags.

Bimax implementation:

- `bimax-cu-bridge` is a separate Swift executable. It accepts bounded NDJSON from the engine, but
  sends every request through `BimaxCuXPCClient`; the service itself gained no stdio request mode;
- before opening XPC and before every request, the bridge walks its live parent chain and requires
  a signed `ai.bimax.app` ancestor. A copied/spawned bridge therefore cannot borrow native authority
  from an unrelated local process;
- both XPC directions now derive a same-Developer-ID-team requirement at runtime. Identifier plus
  Apple anchor alone was insufficient because another team could sign the same identifier;
- unsigned/ad-hoc builds have no team and fail closed unless the existing
  `BIMAX_CU_ALLOW_UNTRUSTED_CLIENT=1` same-user development override is explicitly set;
- release staging builds `bimax-cu-service` and `bimax-cu-bridge`; Electron packages the XPC bundle
  and bridge separately and passes both resolved paths to the engine;
- `NativeBridgeProcessPort` serializes requests, enforces 2 MiB/30 s bounds, condemns a timed-out or
  desynchronized bridge, and never retries a request that may have crossed XPC;
- `NativeServiceWireClient` verifies protocol, request ID, session ID, service version, and typed
  errors. `NativeServiceOperationClient` provides handshake/session/workspace/observe/action/
  transaction/capture
  operations, and transaction transport accepts only objects issued by the checked compiler's
  in-process provenance set;
- the client is inactive: failed capture/physical/focus cutover gates still prevent native model
  tool registration, so compatibility `ComputerTool` remains the sole production surface.

Tests: signed-ancestor discovery/refusal/cycle handling, Data-only XPC suite, bridge envelope
self-test, release service+bridge staging, request/response correlation, handshake revalidation,
compiler provenance, no mutation retry, typed service errors, malformed IDs/deadlines/operations,
2 MiB refusal, and bridge disposal. Native foundation: 51/51.

### Phase 6 slice 5: session authority and governed operation tools

Date: 2026-08-01

Reused Bimax source:

- the existing `ComputerTool` governor path, high-impact classifier, sensitive-target hard deny,
  task-session identity, untrusted-screen tainting, and compatibility-cycle fallback;
- the Phase 4 native rule that only complete, event-tracked, capture-stable snapshots may authorize
  an action, plus Phase 6 slice 2's compiler-issued transaction provenance;
- master-plan §14's operation-specific workspace/observe/action/transaction/capture surface.

Bimax implementation:

- `NativeToolCoordinator` owns one native service session per trusted Bimax task, coalesces
  concurrent creation, retains at most four complete full snapshots, and never promotes a diff to
  action authority because unchanged nodes do not receive refs for the diff's new snapshot id;
- full snapshot nodes must carry a complete same-snapshot, exact-window `ElementRef`. Partial,
  truncated, capture-raced, untracked, malformed, and diff-only observations remain evidence but
  cannot authorize actions or transactions;
- prepared actions and transactions carry in-process provenance and exact task/session binding.
  Mutation invalidates the task's retained snapshot authority; a copied/forged prepared object or
  cross-task replay is refused before transport;
- semantic values, text/scroll payload discriminators, postconditions, evidence timeouts, capture
  targets/regions, and SOM snapshot-to-window identity are checked before a Governor prompt;
- `BimaxWorkspaceTool`, `BimaxObserveTool`, `BimaxActionTool`, `BimaxTransactionTool`, and
  `BimaxCaptureTool` execute through the signed bridge. Action approval resolves the actual PID to
  app name/bundle before the existing COMPUTER_CONTROL governor; foreground actions always require
  a real coordinator decision. Transactions expose the compiler-expanded manifest to the audit
  payload and cannot contain commit actions;
- registration requires an eligible discovery probe, an available signed bridge, a second live
  bridge/XPC handshake, and a fresh cutover assessment of that live endpoint. Any disagreement or
  failure returns no native tools. `ComputerTool` remains registered as the one-release
  compatibility path;
- the desktop-turn prompt prefers the small native surface only when it is actually registered and
  permits batching only through the checked transaction tool. Otherwise its existing
  `ComputerTool` contract is unchanged.

Tests: task-session coalescing, full-snapshot authority, diff non-authority, immutable action and
transaction provenance, cross-task refusal, post-mutation invalidation, malformed shape refusal,
SOM exact-window binding, capture transport, discovery refusal, bridge absence/downgrade, dynamic
five-tool registration, and one resolved-target Governor decision. Phase 6 targeted: 29/29.

Gate status: **implementation complete; production cutover refused.** The measured service still
reports no complete ScreenCaptureKit frame, no general physical-input capability, and no verified
foreground focus lease. Therefore the model-visible native registration branch is deliberately
inactive and the turn-count/model-quality rollout gates cannot honestly be measured yet.

### Phase 7 slice 1: converged route receipts and observation-scoped browser refs

Date: 2026-08-01

Reused Bimax source:

- `browser.runtime.ts`'s existing Puppeteer/CDP snapshot, automatic post-action observation,
  workspace-bounded upload, stale-index invalidation, and DOM mutation settle loop;
- `BrowserTool`'s existing COMPUTER_CONTROL governor, domain scoping, untrusted-page taint, and
  durable evidence events;
- the master-plan rule that page content belongs to CDP, browser chrome/system UI belongs to macOS
  semantics, and visual-only work must not appear until native capture is proven.

Finding and implementation:

- a numeric `elementIndex` was invalidated after action/navigation, but a successor snapshot could
  reuse the same number. A delayed call planned against old index `0` then resolved to the new
  observation's index `0` and could hit the wrong DOM element. This was the browser form of the
  stale-ref class the native service already refuses;
- every snapshot element now carries a random opaque `elementRef` retained only with that exact
  observation. Action resolution checks the ref directly, checks an optional accompanying index
  for agreement, and refuses old/malformed/mismatched refs before resolved-target approval or CDP
  delivery. Numeric indexes remain as a compatibility input for this slice;
- high-impact BrowserTool classification now uses the value-safe metadata of the resolved current
  element, so submit/send/etc. controls reach the existing Governor hard boundary rather than only
  uploads being marked high-impact;
- `browser.convergence.route.ts` defines common browser-page, browser-chrome, macOS/system-UI, and
  visual target refs plus an explicit route decision. DOM work has no desktop-pixel downgrade:
  missing CDP blocks. Chrome/system UI requires native semantics; visual-only work requires proven
  native capture;
- BrowserTool results and the gated native observe/action/transaction/capture tools now carry route
  receipts naming the surface, backend, and semantic/capture path.

Tests: DOM-no-pixel route, browser-chrome/native route, capture refusal, old-ref index-reuse
refusal, ref/index mismatch, pre-Governor stale refusal, resolved submit high-impact classification,
route receipts, failure-loop ref identity, and a real local Chromium observe/act/observe run.
Phase 7 targeted: 68/68 offline; Chromium E2E: 2/2.

Remaining Phase 7 gates: typed tab/document refs, dialogs, downloads, browser-chrome live handoff,
system-prompt handoff, and AX scrape fallback are not implemented by this slice. Upload is governed
and workspace-bounded, but the complete upload/download convergence gate remains open.

### Phase 7 slice 2: typed tabs, document epochs, and navigation outcomes

Date: 2026-08-01

Reused Bimax source:

- the existing Puppeteer `Page` lifecycle, popup discovery, CDP navigation/action delivery, and
  observe-after-action snapshots in `browser.runtime.ts`;
- BrowserTool's existing domain checks, COMPUTER_CONTROL Governor boundary, page-content taint,
  route receipt, and workspace-bounded upload path.

Finding and implementation:

- Puppeteer could already create and enumerate popup pages internally, but the public tool had
  only one implicit active page. It had no stable tab identity, no exact switch/close operation,
  and no document generation. A command prepared before a navigation could therefore carry a
  current element ref check but could not prove it still addressed the same tab and document;
- every managed page now receives a random opaque `tabRef`, and every main-frame navigation
  rotates a random opaque `documentRef`. The refs are service-owned, never derived from titles or
  URLs, and page close removes their authority;
- ordinary commands may name only the current tab and document. `switch_tab` and `close_tab` may
  name a non-active tab exactly; a stale or mismatched tab/document is refused in BrowserTool
  before approval and checked again in the runtime before delivery;
- `tabs`, `switch_tab`, and `close_tab` expose typed tab records. Switching clears observation
  element authority, closing selects an existing successor (or creates one when necessary), and
  the route receipt carries the selected tab/document target;
- `navigate`, `back`, `reload`, and actions that cause navigation now return a typed outcome with
  the before/after document refs, URL, change bit, and status. `back` with no history reports an
  explicit failure instead of looking like a successful no-op;
- same-document main-frame events conservatively rotate the document ref. This may force a fresh
  observation after a hash/history transition, but cannot preserve stale authority across a
  potentially changed document.

Tests: opaque tab identity, popup listing, exact tab switch/close, active-tab enforcement,
document rotation on navigate/reload, stale-document refusal before the Governor, action-key
separation by document, typed route targets, and a real local Chromium popup/switch/reload/close
run. Phase 7 slice 2 targeted: 66/66 offline; Chromium E2E: 2/2.

Validation note: the Chromium assertions pass and Jest exits zero, but reports its delayed-exit
open-handle warning after the suite. That harness cleanup warning remains a follow-up; it is not
being presented as a completely clean runner exit.

Remaining Phase 7 gates: governed dialogs/downloads, live browser-chrome and system-prompt
handoff, and AX scrape fallback. Upload remains governed and workspace-bounded; the complete
upload/download boundary is still open.

### Phase 7 slice 3: governed downloads; deferred-dialog gate failed

Date: 2026-08-01

Reused Bimax/Chromium source:

- BrowserTool's existing workspace-bounded upload, FILE_WRITE and COMPUTER_CONTROL Governor
  decisions, page-content taint, and typed browser route receipt;
- Puppeteer's page `dialog` event plus CDP's browser-level `Browser.setDownloadBehavior`,
  `Browser.downloadWillBegin`, `Browser.downloadProgress`, and `Browser.cancelDownload` contracts.

Download implementation:

- browser launch sets downloads to `deny`; no page can write a download merely because a click or
  navigation reached an attachment;
- `download_prepare` validates the destination lexically and through existing-ancestor realpaths,
  honors read-only multi-repo workspace scope, obtains a FILE_WRITE Governor decision, and arms
  exactly one `allowAndName` transfer with an explicit byte cap (100 MiB default, 1 GiB hard max);
- the first transfer consumes the permit. Concurrent or later unarmed transfers are canceled, and
  terminal completion restores `deny`;
- Chromium's GUID staging filename is moved only after completion to a sanitized, collision-safe
  suggested filename inside the approved directory. Forbidden workspace-policy names are refused,
  oversized/aborted files are removed, and completed receipts carry relative path, exact byte
  count, SHA-256, tab/document refs, and an opaque `downloadRef`;
- `downloads`, `download_wait`, and governed `download_cancel` expose the typed lifecycle without
  exposing CDP GUIDs. Page-supplied URL/filename data remains tainted.

Dialog gate measurement and refusal:

- trusted mouse input can open a JavaScript modal and emit its exact type/message/default value,
  but Chromium withholds the triggering mouse-release acknowledgement until that modal is
  resolved;
- deferred resolution was measured through Puppeteer's original dialog handle, a newly attached
  page session, a page session attached before the dialog, and the originating input session.
  Every deferred route blocked and the real suite hit its 60-second timeout. This is not shipped
  as working scaffolding;
- an unprepared dialog is now dismissed immediately inside Puppeteer's dialog event callback so
  trusted input cannot wedge the browser. The triggering result and `dialogs` expose an opaque
  typed inspection receipt with `resolution: dismissed_safely`. Deferred accept/prompt submission
  is not in the BrowserTool schema and remains a failed Phase 7 gate.

Tests cover workspace escape refusal before FILE_WRITE/runtime delivery, one-shot preparation,
dialog modal blocking at runtime, bounded transfer cancellation, collision-safe finalization and
digest, safe live confirm/prompt inspection, completed real download evidence, and a second live
unarmed download producing no file or record. Phase 7 targeted: 71/71 offline; Chromium E2E: 2/2.
Both TypeScript builds, scoped ESLint, and `git diff --check` pass. Jest still prints the previously
recorded delayed-exit/open-handle warning after its passing Chromium assertions and zero exit.

Gate status: **upload/download boundary complete; dialog acceptance failed and flagged.** Remaining
Phase 7 gates are deferred dialog accept/prompt, live browser-chrome/system-prompt handoff, and AX
scrape fallback.

### Phase 7 slice 4: exact chrome/system handoff and bounded AX fallback

Date: 2026-08-01

Source-backed design reused:

- MacOS-Use's `macos_use/agent/tools/service.py` AX page-scrape fallback behavior (`MU-047`),
  translated onto Bimax's existing ComputerTool observation path rather than inventing a second AX
  engine;
- Hermes' typed backend/route separation from `tools/computer_use/backend.py` and
  `tools/computer_use/browser_route.py` (`HE-012`/`HE-013`), translated into the existing
  BrowserRuntime and one shared Bimax route receipt;
- the existing ADR/master-plan ownership rule: page DOM stays on BrowserTool/CDP, browser chrome
  and system prompts route to macOS accessibility, and visual-only content never becomes an
  implicit pixel fallback.

Implementation:

- BrowserTool now exposes an explicit `handoff` for `browser_page`, `browser_chrome`, and
  `system_ui`. Page/chrome PID is derived from the owned Chromium process; system UI requires the
  exact owner PID previously resolved through ComputerTool. Optional window identity requires the
  `windowId`/`windowGeneration` pair;
- a successful handoff mints a random, 60-second, task-session-bound authority over the exact
  retained target. ComputerTool refuses unknown, expired, cross-task, surface-mismatched, and
  model-altered targets before Governor approval or desktop delivery;
- `browser_page` fallback permits only `observe`. All page mutation returns to CDP, and no route
  falls through to desktop pixels. Browser chrome/system actions may continue through the existing
  ComputerTool accessibility/desktop path;
- receipts call that temporary path `computer_compat`/`compatibility_desktop`; they do not claim the
  still-blocked native-service cutover. AX page fallback additionally refuses to route without an
  exact positive PID;
- the session prompt teaches the same boundary, and browser failure-loop keys distinguish handoff
  surface, PID, window ID, and generation.

Validation:

- Phase 7 offline suites: **92/92** across convergence, observation, recovery, BrowserTool,
  ComputerTool, and prompt-contract tests;
- live Chromium fixture: **2/2**, including real owned-process page/chrome handoff plus the existing
  typed dialog and governed-download paths;
- root and app TypeScript checks pass; scoped ESLint exits zero with warnings only;
  `git diff --check` passes.

The live Jest runner still reports its already-recorded delayed-exit/open-handle warning after a
zero exit. Deferred JavaScript dialog accept/prompt submission remains the one explicit failed
parity item: the safe immediate-dismiss inspection receipt remains shipped, while the deadlocking
deferred API is not advertised.

Phase 7 closure: **complete under the user's fail-forward rule.** Every listed Phase 7 gate passes:
ordinary DOM does not use pixels, browser chrome is operable through an exact governed handoff,
upload/download boundaries are governed, and stale refs are refused. The deferred-dialog failure
is carried forward visibly rather than treated as passing evidence. Phase 8 is next.

### Phase 8 slice 1: governed application resolution and background launch

Date: 2026-08-01

Translated source:

- `/Users/vishsiddharth/Desktop/MacOS-Use/macos_use/ax/core.py`, pinned at
  `c88574c0a70534a21e9490e2118f1fce04e16904`: `GetApplicationPathByBundleID`,
  `GetApplicationPathByName`, and `LaunchApplication`;
- the Codex exposed contract's background app resolution (`CXP-005`).

Three deliberate divergences from upstream, each a security property rather than a preference:

- upstream `LaunchApplication` shells out to `open -a <name>` and falls back to the deprecated
  `NSWorkspace.launchApplication(_:)`. Both activate the target, and a subprocess is exactly the
  arbitrary-execution path master-plan §10.11 keeps out of this service. Bimax-Cu uses
  `NSWorkspace.openApplication(at:configuration:)` with `activates`, `addsToRecentItems`,
  `createsNewApplicationInstance`, and `promptsUserIfNeeded` all false;
- upstream's name lookup accepts a full filesystem path, so its launcher can start any bundle on
  disk. `AppLookup` has no path case, and both the service and the coordinator refuse path-shaped,
  control-character, and over-length lookups. The protocol cannot express "run this binary";
- upstream returns a bare `bool`. `AppLaunchReceipt` carries the frontmost PID measured before and
  after the call, and `frontmostChanged` is a *derived* property — a forged wire value cannot
  override the receipt's own measurements.

Bimax implementation:

- `AppWorkspace.swift` holds the policy behind a `LaunchServicesProviding` seam, so launch rules are
  testable offline without starting real processes; `SystemLaunchServices` is the only AppKit part;
- opening an application that is already running raises it, so an existing instance ends the request
  with `outcome: already_running` and nothing is opened. This is a background-delivery requirement,
  not an optimization;
- readiness is a bounded poll of the process's own `isFinishedLaunching`, never a fixed sleep, and
  an unready process is reported unready rather than assumed started;
- `WorkspaceCapabilities` gains `operations` (accepted) and `verifiedOperations` (proven), matching
  the existing advertised-versus-verified rule. `verifiedWorkspaceOperations` in
  `native.service.client.ts` intersects the two, so a service that "verifies" an operation it does
  not accept grants nothing;
- `BimaxWorkspaceTool` resolves *before* it asks the Governor, so a COMPUTER_CONTROL decision names
  the bundle path and identifier Launch Services actually chose rather than the string the model
  typed. A denial reaches the tool before any launch request exists;
- `XPCClient.retrySafe` treats resolution as replayable and a launch as not: an interrupted launch
  may already have started a process.

Live evidence (`scripts/conformance-bimax-cu-workspace.sh`, run 2026-08-01): **5/5 checks**.
Resolution found the fixture without starting it; the launch started PID 7889 while the frontmost
PID stayed 9738 across the whole call; a second launch returned `already_running` and opened
nothing; a path lookup was refused with `invalid_app_lookup`; the harness terminated the fixture it
started. Launch Services does not index bundles under `/var/folders`, so the run stages the fixture
in `~/Applications`, registers it with `lsregister`, and removes it on exit — including on failure.
`verifiedWorkspaceOperations` is `["resolve_app", "launch_app"]` because that run passed, and the
run fails if the handshake ever claims more than it reproduced.

Offline evidence: native foundation **54/54** (3 new: launch policy, path refusal plus foreground
honesty, and the service/wire contract). Phase 8 targeted TypeScript **60/60** across 8 native
suites, including forged/cross-task prepared launches, unverified-operation refusal, legacy
handshake tolerance, and the resolve-before-approve ordering. Root TypeScript passes; scoped ESLint
over the slice's files exits zero.

Not in this slice, and not implied by it: open file, open URL, reveal in Finder, window mutation,
Spaces, and application quit. Quit in particular is a commit action with an unsaved-work boundary
and does not belong behind a routine workspace approval.

### Phase 8 slice 2: governed file and URL helpers

Date: 2026-08-01

Translated source: `/Users/vishsiddharth/Desktop/MacOS-Use/macos_use/ax/core.py`, pinned at
`c88574c0a70534a21e9490e2118f1fce04e16904` — `OpenFile`, `OpenURL`, `SelectFileInFinder`,
`RecycleFiles`, `DuplicateFiles`, `IsFilePackage`, `GetFileInfo`,
`GetLocalizedDescriptionForType`. Reused Bimax source: the Phase 7 governed-download destination
rule (`resolveBrowserWorkspacePath` plus `workspaceWriteBlock`) and its collision-safe finalizer.

Divergences from upstream, each deliberate:

- upstream `RecycleFiles` passes a nil completion handler and returns `True` for "initiated".
  Bimax-Cu uses `FileManager.trashItem(at:resultingItemURL:)`, which is synchronous and reports
  **where the item landed** — a delete nobody can locate is a delete nobody can undo. The
  conformance run checks the original is gone *and* the reported trash path exists;
- upstream `DuplicateFiles` uses the asynchronous `NSWorkspace.duplicate`, whose handler may never
  run in a service with no run loop. Bimax-Cu copies directly to a collision-safe `… copy` name and
  reports the exact resulting path;
- upstream `OpenFile` activates the handler. Bimax-Cu opens with the same non-activating
  configuration as a launch and measures the foreground either way;
- upstream `OpenURL` accepts any scheme. A custom scheme is a request to run whichever local
  application claims it, so only `http` and `https` are expressible — refused in the coordinator and
  again in the service;
- upstream file icon helpers (`GetIconForFile*`) are **rejected**: an `NSImage` has no meaning
  across a Data-only wire, and the capture engine already owns pixels.

Bimax implementation:

- `FileWorkspace.swift` holds the policy behind a `FileServicesProviding` seam. Paths must be
  absolute and already-normalized; the service never expands `~`, resolves relative paths, or
  re-normalizes, because normalizing would mean the coordinator validated one path and the service
  acted on another;
- a dangerous-deletion floor runs **before** the existence check, so the refusal does not vary with
  filesystem state: `/`, the home directory, any ancestor of it, and system-owned prefixes cannot be
  trashed even with an approval;
- `reveal_file` declares `requestedActivation: true`. Revealing *is* bringing Finder forward, so it
  is disclosed up front and its measured foreground change is reported rather than discovered;
- `open_file`'s optional handler goes through the same `AppWorkspace.resolve` a launch uses, so an
  open cannot reach a bundle a launch would refuse;
- the tool layer resolves every path against the active workspace with the download rule — a
  symlink cannot carry an operation out of the workspace — then routes trash/duplicate through
  FILE_WRITE and open/reveal/URL through COMPUTER_CONTROL. Every approval names the resolved
  absolute path or host, never the model's input string.

Live evidence (`scripts/conformance-bimax-cu-workspace.sh`, run 2026-08-01): **12/12 checks**,
adding `inspect_file` (type and size read back), `open_file` (delivered to the inert fixture with
the foreground unmoved), `duplicate_file` and `trash_file` (both re-checked against the real
filesystem, not believed from the receipt), plus live refusals for a home-directory trash, a
`file://` URL, and a relative path. The run creates its own scratch directory and removes its own
item from the Trash.

Deliberately **not verified**, and therefore not in any model enum: `reveal_file` and `open_url`.
Both are foreground-disruptive to whoever is at the keyboard — Finder comes forward, a browser
opens a page — so there is no way to measure them without commandeering the machine the run is on.
They are advertised, implemented, tested offline, and honestly unproven live, the same treatment
`scroll_page` received.

Offline evidence: native foundation **57/57** (3 new: file policy, deletion/scheme refusal, and the
service/wire contract). Phase 8 targeted TypeScript **64/64** across 8 native suites, including
workspace-escape refusal before any transport, FILE_WRITE versus COMPUTER_CONTROL routing, the
high-impact reveal disclosure, and forged/cross-task prepared operations. Root TypeScript passes;
scoped ESLint over the slice's files exits zero.

### Phase 8 slice 4: governed window operations and layout presets

Date: 2026-08-01

Master-plan §10.5's window half: move/resize/minimize/unminimize/close/fullscreen, tiling to halves,
thirds, quadrants, center, and maximize. **Nothing was ported** — MacOS-Use exposes window geometry
as reads only and has no window mutation, so this is behavior-derived from the plan. `MU-032`'s
Window pattern stays discovery-only for the same reason a semantic action never moves a window: it
is a governed workspace operation, not an element action.

Bimax implementation:

- `WindowOperations.swift` reads the window back after every write and reports what it *became*.
  `honored` is computed from that read, never from `AXUIElementSetAttributeValue` returning
  `.success`, and the applied bounds are always reported so an application's own clamping is
  visible rather than mistaken for failure. Nothing is retried;
- exact-window binding is enforced in `ServiceCore` *before* any Accessibility call: the window
  must still exist with the same service-issued generation. WindowServer reuses ids, so a stale
  generation is a different window;
- minimize walks a two-rung ladder — settable `AXMinimized` first, then the window's own
  `AXMinimizeButton` — in the same shape as the semantic delivery ladder. Unminimize deliberately
  has no second rung: a minimized window's buttons are not pressable, so an unsettable
  `AXMinimized` genuinely cannot be undone from here;
- close and minimize poll their requested outcome across a bounded settle, because both animate;
- `native.window.layout.ts` computes layout presets from the display's **usable** bounds and
  delivers them as an ordinary `set_window_frame`, so tiling adds no native authority and no new
  approval path. A display that reported no usable area produces no layout: substituting the full
  display rectangle would tile a window under the menu bar and call it success. The preset resolves
  against the display the window is *actually on*, never one the caller named;
- `BimaxWorkspaceTool` takes a COMPUTER_CONTROL decision naming the resolved window and the preset.
  `close_window` is the one window operation marked high-impact — it can discard unsaved work.

Live evidence (`scripts/conformance-bimax-cu-workspace.sh`, 2026-08-01): **18/20 checks**, all
invariants held, `overclaimed: []`. Verified: `move_window`, `resize_window`, `set_window_frame` —
each honored exactly, with the frontmost PID unchanged across the call, so Accessibility geometry
writes do not take the foreground.

Three platform findings the run produced, all left advertised and **unverified**:

- **an application started without activation can present a WindowServer window with real bounds
  while `AXWindows` returns success and an empty array.** Window mutation resolves through
  Accessibility, so it is simply unavailable for such a process until it has been foregrounded
  once. The harness now activates the fixture it started and says so in a check
  (`window.ax_visible`, `activatedByHarness=true`); that is a harness decision, not a service
  capability;
- **`AXMinimized` is readable and not settable on AppKit windows, and `AXMinimizeButton` advertises
  `AXPress`, returns `.success`, and does not minimize.** Both rungs are inert — the fifth
  "success that changed nothing" in this kit. `minimize_window`/`unminimize_window` are therefore
  not claimed;
- **`close_window` works in isolation** (an application's AX window count went 1 to 0 under a
  direct `AXCloseButton` press) **but did not reproduce through the harness once the fixture
  exposed more than one AX window.** Flaky is not verified, so it is not claimed either.

One earlier defect the run exposed and the harness now avoids: a single PID owns several layer-0
WindowServer rows — the fixture had six, five of them untitled backing stores. "The first layer-0
row for this pid" picked a backing store whose bounds match no AX window, and every operation
failed with `window_not_found`. This is the same class as the `frontmostPid` defect already
recorded: the window list is not a list of windows.

Harness honesty change: checks are now split into invariants (refusals, background behavior,
stale-generation rejection) and capability checks. A capability the platform refuses downgrades the
claim; only a failed invariant or an overclaim fails the run — the rule the focus harness already
used.

Offline evidence: native foundation **60/60** (2 new: window honesty across working/clamping/lying
toolkits plus the ladder, and request-shape policy including stale-generation refusal before any
write). TypeScript **72/72** across 9 native suites, adding layout-preset geometry, display
selection, exact-target refusal, frame/tile exclusivity, and forged/cross-task prepared operations.
Root TypeScript, scoped ESLint, and the 35 computer/browser/prompt suites (559 tests) pass.

### Phase 8 slice 3: usable display bounds, and why Spaces stays refused

Date: 2026-08-01

Master-plan §10.8 asks for enumerated displays with usable bounds, Space create/remove/switch, a
determination of when a target is on another Space, and an explicit explanation where macOS exposes
no stable public API. This slice delivers the first and the last, and measures the rest rather than
approximating them.

Delivered:

- `DisplayInfo.usableBounds` — the menu-bar/Dock-free area from `NSScreen.visibleFrame`, converted
  into the same top-left global space as every other rectangle on this wire. A display with no
  matching live screen reports **no** usable bounds; falling back to the full display rectangle
  would be an answer that looks measured and is not;
- `WorkspaceSnapshot.displaysHaveSeparateSpaces` — the one publicly readable Spaces fact, because
  it changes what a display-scoped answer means.

Measured, and the reason Spaces mutation is not implemented:

- **switch/create/remove have no public API.** The routes are private CoreGraphics Spaces calls,
  which ADR-002 and §10.8 forbid claiming as stable, or Mission Control keyboard automation, which
  needs the global CGEvent stream. `PhysicalInputMechanism.global_stream` is still unimplemented
  (Phase 4 slice 3/4: only `postToPid` is available, and it names a process rather than the
  window server). So Spaces mutation is blocked behind a dependency that is itself refused, not
  behind missing effort;
- **"is this window on another Space" cannot be answered from the public window list.** Measured on
  this machine: 103 layer-0 windows exist and 4 are on-screen. The other 99 are headless Chromium
  windows from the browser suites, `CursorUIViewService` helpers, and similar — none of them on
  another Space. Treating off-screen as "other Space" would have mislabeled 99 windows. Minimized
  state is not in the window list either, so there is no public signal that separates the cases;
- upstream has nothing to port here. At `c88574c0`, MacOS-Use's `desktop_tool` calls
  `desktop.manage_spaces(...)` and `_Desktop` defines no such method — the documented
  create/remove/switch behavior is a docstring, and the call raises.

`WorkspaceCapabilities.spaces` therefore stays `false`, and `SpacesDisplays` remains a planned
module rather than a shipped one advertising an operation it cannot perform.

Evidence: native foundation **58/58** (1 new: conversion for the primary display, a display above
the primary with a negative AppKit origin, a display below/right, absent usable bounds surviving the
wire as absent, and a legacy snapshot not implying per-display Spaces). The workspace conformance
run stays **12/12**. Root TypeScript and the 29 computer suites (477 tests) pass.

### Phase 8 slice 5: secondary Accessibility action

Date: 2026-08-01

This slice starts the post-window parity work with the missing Codex exposed-contract semantic:
the secondary action. Bimax-Cu represents it as `show_menu`, delivered only through an element's
advertised `AXShowMenu`. It is not a right-click alias and has no coordinate fallback, because that
would silently turn a background semantic request into global physical input. Nodes advertising
`AXShowMenu` now carry the distinct `secondary_action` pattern.

The request has no model-controlled payload and keeps the existing exact snapshot/window, event
revision, evidence, delivery-policy, and focus rules. The live catalog fixture now advertises and
performs `AXShowMenu` on its popup control, so `show_menu` is in `verifiedSemanticActions` without
weakening the no-coordinate-fallback rule.

Evidence: native foundation **60/60** passes, including secondary-pattern classification and
payload refusal. Live catalog conformance reports `show_menu: performed`, no overclaim, and only
the known inert `scroll_page`/unadvertised `scroll_to_visible` primitives as unverified.

### Phase 8 slice 6: task-owned cursor, trajectory, and replay policy

Date: 2026-08-01

`native.product.features.ts` establishes authority and lifecycle rules before any native product
operation is advertised. Cursor state is isolated by task and requires measured
`overlay.cursor: true`. Trajectories contain at most 1,000 operation/target/receipt digests, not
arbitrary model text or pixels. Replay is task-bound, refuses truncated recordings, validates every
step immediately before use, and permits live execution only with explicit approval plus an
injected executor.

The v1 handshake grows an optional overlay group. Older services decode absence as unsupported and
the current service explicitly reports `cursor: false`. Existing recording capabilities remain
false: this slice does not claim an overlay renderer, native video writer, or replay transport.

Evidence: the product-feature TypeScript suite passes **4/4**, covering task isolation,
unadvertised-capability refusal, dry-run/validate/live policy, cross-task refusal, and validation
before execution. Root TypeScript passes.

### Phase 8 slice 7: exact-bundle application profiles

Date: 2026-08-01

`NativeAppProfileRegistry` adds bounded declarative guidance and recipes. A concrete bundle id is
matched exactly; display-name fallback is considered only when no bundle id exists, preventing a
look-alike application from inheriting trusted guidance. Profiles cannot add tools, commands,
approvals, or capabilities. Receipts are copied, delivered once per bundle per task, and cleared
with task teardown.

The first profiles cover Finder, supported Chromium/Safari browsers, and System Settings. Native AX
observations attach `appGuidance` on the first observation for the bundle. This reuses Bimax's
existing memory/event/voice layers instead of introducing a second writable memory channel;
`MU-049` remains rejected.

Evidence: the app-profile suite passes **4/4**, including once-only task delivery, look-alike bundle
refusal, defensive receipt copies, bounded content, and duplicate authority rejection. Native
coordinator/tool regression suites pass.

### Phase 8 slice 8: doctor UI bridge and governed external MCP boundary

Date: 2026-08-01

The doctor and external MCP implementations predated this entry. This slice closes their opaque and
unsafe edges. Synchronous desktop UI snapshots can read the last cached native-service probe without
spawning a process; the Computer Use card shows reachability, full/semantic cutover posture, TCC
state, signing, blocker count, and a doctor action. Missing grants change that action into the
existing permission walkthrough, which opens the responsible System Settings panes and re-probes.

The `mcp-computer` schema rejects additional fields and does not expose the whole-display recording
token. External MCP is read-only by default. Acting verbs require a host-injected approval broker;
no environment boolean or model field stands in for approval, and denial never reaches the runtime.

Evidence: the MCP boundary suite passes **3/3**. The current CLI server has no injected approval
broker, so its external surface is intentionally read-only.

### Phase 8 closure: advanced parity and live breadth gates

Date: 2026-08-01

Phase 8 is complete at the product boundary. The final slice removes the unexplained gaps without
claiming that every compatibility transport has already been deleted:

- `MU-040` reads one primary plus up to three related app/system-UI trees concurrently through
  independent signed bridges under the same task session. Results stay ordered; a failed branch
  rejects the batch; auxiliary bridges are always disposed.
- `MU-041` adds bounded label corrections for window controls, links, cells, and groups. It never
  substitutes a child's AX role/reference for its parent, so corrected text cannot confer action
  authority on a different element.
- ScreenCaptureKit produced four complete 1120×976 fixture frames with no idle-frame substitution.
  Image, SOM, region capture, and zoom are therefore advertised; continuous streams remain a
  separate presentation capability.
- all five delivery policies pass live focus conformance. Foreground-once takes the exact fixture
  PID and restores the exact prior PID; persistent focus retains the target. The desktop broker now
  restores Electron through the same exact-PID helper used for acquisition.
- the real-app/background matrix sampled 12 heterogeneous running AX servers. Four returned
  non-empty, complete trees (WhatsApp, Aside, Claude, and ChatGPT); empty trees were reported as
  `empty`, not passes. Calculator, System Settings, and TextEdit were temporarily launched through
  the non-activating path and only instances created by the harness were terminated. The foreground
  PID was preserved throughout.
- PiP, opt-in recording, global physical input, and their mature cleanup remain owned by the
  compatibility `ComputerTool` during migration. Native cursor/video/replay flags stay false until
  equivalent transports exist. This is an explained Phase 9 migration boundary, not missing product
  behavior. The optional synthetic cursor overlay is rejected for Phase 8 because the real cursor
  and capture-safe PiP already expose delivery without adding a second misleading pointer.
- external MCP remains read-only unless embedded by a host that supplies a real Governor callback;
  a standalone stdio process cannot safely manufacture desktop approval authority.

Validation: native foundation **60/60**; native/MCP TypeScript **86/86**; product PiP,
recording, trajectory, and deterministic replay **214/214**; root and app TypeScript pass. Live
catalog, capture, focus, workspace, and real-app/background conformance pass. Timed 30-minute and
8-hour endurance runs remain Phase 9 release-ramp gates from Milestone G; Phase 8's bounded-state
and replay suite is complete and does not relabel an unrun release soak as evidence.

### Phase 9 slice 1: additive semantic opt-in

Date: 2026-08-01

Phase 9 has started. `assessNativeSemanticOptIn` inherits every full-cutover signing, TCC,
observation, verified-catalog, capture, and focus-lease gate and removes only the global
`physicalInput` requirement. With `BIMAX_CU_NATIVE_SEMANTIC_ROUTING_ENABLED=1`, the signed native
workspace/observe/action/transaction/capture tools register additively while `ComputerTool` remains
registered for global pointer/key work and rollback. The stricter `assessNativeCutover` is unchanged
and still refuses full replacement until physical input is native-proven. Discovery and the live
bridge are assessed independently, so a stronger cached handshake cannot authorize a weaker XPC
endpoint.

The doctor UI reports `semantic opt-in ready` separately from `full cutover ready`; enabling the
environment gate is necessary but cannot override a failed structural gate. Registration tests
prove that a physical-input-false service can enter only semantic mode and that full mode still
fails closed.

### Phase 9 slice 2: fail-open observation shadowing

Date: 2026-08-02

`BIMAX_CU_NATIVE_SHADOW_ENABLED=1` enables a narrower read-only shadow path after a successful
compatibility `observe`. The compatibility result is returned immediately and unchanged;
`ComputerTool` does not await the shadow, does not expose its receipt to the model, and catches an
unexpected observer rejection. The shadow surface has no action/transaction method.

Eligibility requires a real signed service, Accessibility trust, both application/window scopes,
AX diffs, event revisions, and at least one bounded observation profile. It deliberately does not
require capture, focus, semantic actions, or physical input because none can be exercised by this
path. Discovery and the live bridge are assessed independently.

For an exact compatibility PID/window, the controller uses native workspace inventory to recover
the current window generation before observing. If that exact window is absent, it falls back to
application scope and marks `exactWindow: false` rather than fabricating an exact comparison.
Per-task overlap and global concurrency above two are shed, never queued. Receipts are capped at 64
and contain only counts, aggregate signature digests, overlap ratios, and redacted error codes—no
labels, values, screenshots, task identifiers, or individual semantic hashes. Doctor/CLI status
shows compared/skipped/failed counts and the last agreement bucket.

Evidence: the shadow suite passes **4/4**, and the shadow/service/ComputerTool integration set
passes **54/54**. Root and app TypeScript pass. The staged development service remains correctly
ineligible because its live handshake reports `serviceSigned: false`; a Developer-ID-signed build
is required before collecting cohort evidence.

### Phase 9 release-candidate completion: cohorts, default, rollback, and packaging

Date: 2026-08-02

Phase 9's implementation is complete as one release-candidate pass. `NativeRolloutController`
provides deterministic basis-point cohorts, explicit signed-evidence approval, a bounded 100-sample
content-free health window, persistent atomic circuit state, immediate trips for ambiguous delivery
or correlation faults, and failure-budget trips for service availability. Governor/user refusals,
model validation errors, stale elements, and application refusals are rollout-neutral. A failed
native mutation is never replayed through compatibility.

macOS now defaults to signed semantic native routing after both discovery and the live bridge pass
the structural gate. `/computer backend compatibility|native|cohort|reset` is the operator control;
changing modes never silently clears a trip. UI and CLI status expose mode, cohort state, sample and
failure counts, and a redacted trip reason.

The first-party desktop helper is compiled for the target architecture at build time and injected
through `BIMAX_DESKTOP_HELPER`; runtime `swiftc` and source extraction are removed. Default macOS CLI
artifacts omit the CUA binary while preserving `ComputerTool` rollback through that helper.
`BIMAX_PACKAGE_CUA_COMPAT=1` produces the one-release emergency artifact, and non-macOS builds keep
the compatibility sidecar. Electron signing is no longer hard-disabled, allowing a real Developer
ID release to satisfy `serviceSigned` for the nested XPC service.

Local evidence: root/app TypeScript builds, app production bundle, protocol mirror, Go TUI tests,
arm64/x86_64 helper compilation, native foundation 60/60, and the complete Jest suite are release
gates for this candidate. Developer-ID/notarization, signed shadow and cohort matrices, the 8-hour
soak, and the two-release time gate remain external qualification in
`docs/BIMAX_CU_CUTOVER_RUNBOOK.md`.

### Phase 5 on-device image analysis

Date: 2026-08-01

Extracted Bimax source:

- `src/computer/helper.source.ts:visual-signatures`: bounded 7×7 inset sampling, median and
  dominant sRGB colors, OKLab conversion, luminance, entropy, confidence, and the 160-region cap;
- `src/computer/helper.source.ts:visual-analysis`: one foveated `VNRecognizeTextRequest`, fast mode
  without a query and accurate/language-corrected mode with a query.

Bimax-Cu implementation:

- `image.analyze` redeems only a session-owned, descriptor-validated image handle; image paths and
  arbitrary files never enter the service contract;
- fingerprint and OCR rectangles use final encoded-image pixels with a top-left origin;
- decoded bytes are normalized to sRGB once, sampled on the bounded grid, and returned as typed
  `VisualFingerprintRef`/`OCRTextRef` evidence;
- duplicate/empty IDs, malformed regions, more than 160 fingerprint regions, forged handles, and
  empty analysis requests fail closed;
- Vision failures are returned as bounded typed errors with no text, so unavailable OCR cannot be
  mistaken for an empty or successful recognition result.

Tests: real PNG handle analysis, top/bottom coordinate orientation, red/blue classification,
49-sample bounds, OCR success-or-explicit-platform-error, forged handles, duplicate IDs, region cap,
and empty-request refusal.

### Phase 5 evidence tiers and adaptive settle

Date: 2026-08-01

Reused Bimax policy:

- `src/computer/verification.ts`: delivery is not proof, pixel change is supporting evidence only,
  and explicit semantic postconditions are evaluated separately;
- master-plan §16: tiers 0–4, preexisting-condition exclusion, and deadline-based adaptive settle.

Bimax-Cu implementation:

- every native semantic action reports its automatically achievable evidence tier: tier 1 for AX
  actions and tier 2 for targeted text/scroll delivery;
- callers may require a minimum tier; tier 3 region and tier 4 audit requests are rejected before
  mutation because those physical/high-impact paths are not implemented;
- fresh AX postconditions support text present/absent, exact value, value change, focused state,
  selected state, and element existence as a conjunction;
- a postcondition already true in the authorizing snapshot is refused before delivery;
- `AdaptiveEvidenceSettler` observes fresh authoritative AX state with deadline-bounded exponential
  backoff and returns satisfied, timed-out, or unavailable evidence without hiding a delivered
  action behind a generic error.

Tests: wire round-trip, one-observation settlement, preexisting refusal without mutation,
unsupported-tier refusal, deterministic timeout with newest unmatched state, conjunction, and text
absence.

### `MU-043`: SOM annotation renderer

Date: 2026-08-01

Translated source: MacOS-Use `macos_use/agent/desktop/service.py:get_annotated_screenshot`, pinned at
`c88574c0a70534a21e9490e2118f1fce04e16904`.

Bimax-Cu implementation:

- `SOMRenderer.swift` preserves original element indexes, suppresses duplicate/empty boxes, clips
  off-image rectangles, uses deterministic per-index colors, and moves top-edge labels below their
  boxes;
- the result records the source image's rectangle inside the padded canvas, preventing annotation
  padding from silently shifting screenshot coordinates;
- the renderer returns a native image that passes through the same precision PNG encoder;
- `capture.image` mode `som` requires an exact window target and the ID of one retained,
  authoritative, full AX snapshot for the same PID/window/generation;
- `SOMCaptureComposer.swift` maps global AX point bounds into the captured window's source pixels,
  preserves the renderer's padding, then reports marks and the source-content rectangle in final
  encoded-image pixels after model scaling;
- every emitted mark carries the exact snapshot-bound `ElementRef`; display SOM, cropped SOM,
  missing/evicted snapshots, and target/snapshot mismatches fail before the capture provider runs;
- SOM obtains an uncropped 4,096-pixel precision PNG source internally, then applies the caller's
  requested PNG/JPEG/model limit to the annotated canvas;
- the handshake's `som` flag remains false because the exact production service binary's
  permissioned live gate returned only `SCFrameStatusSuspended` frames.

Tests: padding, index gaps, duplicate suppression, clipping, label placement, deterministic color,
encoded output dimensions, legacy wire defaults, snapshot authority binding, provider preflight,
raw handle redemption, and exact padding/scaling transforms.

### `MU-043`: mixed-DPI capture/SOM geometry

Date: 2026-08-01

Translated source:

- `/Users/vishsiddharth/Desktop/MacOS-Use/macos_use/ax/core.py`,
  `GetPerDisplayInfo`, pinned at `c88574c0a70534a21e9490e2118f1fce04e16904`;
- `/Users/vishsiddharth/Desktop/MacOS-Use/macos_use/agent/desktop/service.py`,
  `get_annotated_screenshot` logical-to-pixel mapping at the same commit.

Bimax implementation:

- `CaptureGeometry.swift` selects the owning display and applies that display's independent x/y
  pixel scale;
- global logical rectangles crossing a display boundary are clipped into one display-local pixel
  region per capture, avoiding a single global Retina scale or a stitched-display assumption;
- invalid display geometry and off-display points produce no mapping authority;
- no screenshot, stream, or SOM capability is advertised by this slice.

Tests: Retina and non-Retina points, vertically offset display origins, cross-display rectangle
splitting, off-display refusal, and invalid-display rejection.

License impact: translated MIT source; file header and `THIRD_PARTY_NOTICES.md` retain attribution.

### `HE-005` / `CXP-001`: retained element refs and AX diffs

Date: 2026-07-31

Behavior references:

- Hermes maps compact model-facing element indices/tokens to a retained backend snapshot;
- the exposed Codex contract returns AX diffs by default after an initial full state.

Bimax implementation:

- independent Swift store retaining a bounded number of canonical graphs per trusted task;
- random snapshot-bound tokens are authorization handles; deterministic path hashes are comparison
  keys only;
- diffs are typed insert/update/remove operations with strict same-session/target/profile bases;
- reset, close, eviction, cross-session refs, forged removals, and expired bases fail closed;
- oversized diffs degrade to a full snapshot rather than losing state.

Tests: exact replay, wire round-trip, semantic update compaction, session isolation, ref resolution,
eviction, reset invalidation, malformed operations, and full-fallback behavior.

License impact: behavior-only; no Hermes or proprietary Codex implementation copied.

### `MU-004` / `MU-008` / `MU-039` / `MU-052`: clipped, scoped, partial AX evidence

Date: 2026-07-31

Translated behavior:

- intersect element geometry with the owning window and remove fully off-window subtrees;
- set a short per-application Accessibility messaging timeout;
- include only a fixed set of macOS system UI processes instead of traversing every accessory or
  background helper.

Bimax additions:

- explicit `application`, `window`, and `system_ui` protocol scopes with scope/target consistency
  validation and a scope-bypass rejection for allowlisted system processes;
- Dock item role support plus a fixed lowercase bundle allowlist for Dock, Control Center,
  SystemUIServer, and Spotlight;
- configurable 100–5000 ms capture budget (750 ms default), checked between synchronous AX calls,
  with the existing 500 ms per-call native timeout retained;
- aggregated content-free `ax_timeout`, `ax_read_failed`, and `capture_budget_exceeded` issues,
  including an empty partial response when exact-window root resolution times out;
- `partial`, `truncated`, and `clippedNodeCount` are distinct: incomplete reads, policy budgets, and
  geometric pruning are never conflated;
- partial or truncated evidence is returned for recovery but rejected by the retained store and
  cannot become a diff base or action authority.

Attribution: `AccessibilityEngine.swift` header and `THIRD_PARTY_NOTICES.md`.

Tests: legacy scope defaults, capability scopes, allowlist acceptance/denial/bypass, malformed scope,
duration bounds, intersection geometry, diagnostic wire preservation, store rejection, and action
authority rejection.

### `MU-005` / `MU-006` / `MU-016` / `MU-018`–`MU-021` / `MU-026`–`MU-029` / `MU-031`: semantic AX actions

Date: 2026-07-31

Translated behavior:

- enumerate supported AX action names before invoking press, increment, or decrement;
- test `AXValue` settability before typed value mutation;
- map invoke, toggle, selection, and expand/collapse patterns to their native AX primitives;
- return an already-satisfied result when expanded state already matches the request.

Bimax additions:

- exact task-session token and retained-snapshot authorization; exact-window PID and generation are
  mandatory for this initial mutation slice;
- event revision supplied by the caller, live observer checkpoint before work, and a second
  checkpoint immediately before the AX mutation;
- bounded rewalk from the current window root with stable-path, role, subrole, identifier, enabled,
  and geometry checks—no cached native element is reused;
- fixed typed action/value schema, bounded strings, finite numbers, secure-field refusal, no
  arbitrary AX names, and background-native delivery without activation/global input fallbacks;
- successful mutation consumes all retained refs for that exact target; XPC mutation requests are
  never replayed automatically;
- receipts record exact primitive, no-op/performed outcome, timing, observer epochs, and frontmost
  PID before/after.

Attribution: `AXSemanticActionEngine.swift` file header and `THIRD_PARTY_NOTICES.md`.

Tests: wire round-trip, capability catalog, successful receipt, one-shot authority invalidation,
stale-event rejection, injected pre-mutation race, exact-window requirement, and unavailable-event
tracking rejection.

### `MU-019` / `MU-023` / `MU-030` / `MU-033` / `CXP-004`: text selection and page scrolling

Date: 2026-07-31

Translated behavior:

- `TextPattern` reads `AXValue`, `AXSelectedText`, `AXSelectedTextRange`, `AXNumberOfCharacters`,
  and `AXVisibleCharacterRange` to describe a text control;
- `ScrollPattern` maps up/down/left/right to `AXScrollUpByPage`, `AXScrollDownByPage`,
  `AXScrollLeftByPage`, and `AXScrollRightByPage`, and reads scrollbar `AXValue` as a percentage;
- `ScrollAreaControl` locates the horizontal and vertical scrollbars through their AX attributes.

Bimax additions:

- MacOS-Use exposes text state as reads only; Bimax adds bounded selection mutation through
  `AXSelectedTextRange` with UTF-16 offsets validated against the live document;
- exact-text selection with optional prefix/suffix disambiguation, refusing both zero matches and
  ambiguous multiple matches instead of ranking candidates, plus before/after caret placement;
- caret placement at an explicit index, document start, or document end;
- needle and document size caps, NUL/empty needle refusal, and settability checks;
- secure roles and subroles refused for selection, caret, and scroll — not only for value writes;
- pure, offline-testable range/match/caret resolution separated from every Accessibility call, and
  a pure request-shape policy that runs before the live tree is touched;
- reuse of the existing session/token/snapshot/generation/epoch/rewalk/checkpoint pipeline with no
  new authorization path, and one-shot authority consumption on success;
- content-free receipts: offsets, counts, and scrollbar percentages only, with unreadable scrollbar
  positions reported as unknown rather than as proven movement;
- one page per request, through the element's own advertised action, with no CGEvent scroll wheel,
  pointer movement, coordinate targeting, or repeated-page expansion.

Attribution: `AXTextScrollPatterns.swift` file header and `THIRD_PARTY_NOTICES.md`.

Tests: wire round-trip and additive legacy decoding, unknown action/payload rejection, UTF-16 match
resolution with prefix/suffix disambiguation, ambiguity and not-found refusal, oversize needle and
document refusal, range and caret bounds, request-shape policy including secure and role gating,
`AXValue` `.cfRange` boxing round-trip and type-confusion refusal, scrollbar percentage parsing,
scroll action mapping and unknown-movement reporting, and the full service pipeline covering payload
delivery, receipt redaction, authority consumption, and single-attempt failure.

Live validation: `scripts/smoke-bimax-cu-text-scroll.sh` drives the shipping engine against a real
running application without launching, activating, raising, quitting, or typing. A run against
Terminal confirmed exact-window observation, caret placement, bounded range selection, live
`ambiguous_text_match` refusal, and an unchanged frontmost PID that was not the target's — the
background invariant holding through a real mutation. It also confirmed that a receipt reports the
*applied* selection: Terminal clamped a requested end caret from 73 to 50 and the receipt said 50.
Page scrolling remains unproven live; no app in the smoke sample advertised `AXScrollDownByPage`.

### `MU-016`–`MU-025` / `MU-031` / `MU-032`: capability discovery instead of a control class hierarchy

Date: 2026-07-31

Upstream shape:

- MacOS-Use exposes a `Control` base class plus roughly twenty per-role subclasses, each wrapping
  the same `GetAttribute`/`PerformAction` primitives with role-specific convenience properties;
- patterns are separate classes with `IsSupported(element)` static probes.

Bimax decision:

- the per-role class hierarchy is **rejected**. It is an ergonomic for Python callers holding live
  element objects; Bimax-Cu's callers are across an XPC boundary and hold refs, not elements.
  Reproducing it would create exactly the per-role table the universal-not-per-app rule forbids;
- the useful content of those classes — *what can this element do* — is instead emitted as data on
  every node: `settableAttributes` from live settability probes over the four attributes Bimax-Cu
  can act on, and `patterns` classified from live role, advertised actions, and settability;
- `IsSupported` becomes classification at observation time, so a caller never needs a second round
  trip to discover capability;
- explicit item selection landed as `set_selected` through `AXSelected`; live Phase 4 conformance
  later proved sequential row writes replace selection in AppKit, so additive multi-selection uses
  one atomic container `AXSelectedRows`/`AXSelectedChildren` transaction write;
- the Window pattern is discovery-only: window mutation stays a governed workspace operation, not a
  semantic element action.

Tests: pattern classification across invoke/value/range/toggle/expand/scroll/scroll-to-visible/
selection/text/window, refusal of the text pattern on non-text roles, an inert role advertising
nothing, and request-shape policy for explicit selection state and scroll-to-visible including secure
refusal.

### Catalog conformance: advertised versus verified

Date: 2026-08-01

Problem: offline tests use synthetic `AXNode` values, so they can pass while the live path is
inert. This happened twice in Phase 3 — scroll containers were never emitted and so had no element
ref, and an Electron text area returned success from `AXUIElementSetAttributeValue` while ignoring
the write. Advertising 15 actions with 4 ever exercised live was an overclaim.

Implementation:

- `BimaxCuFixture.app` (the plan's §23.2 fixture) — a programmatic AppKit window with a button,
  checkbox, text field, text view, slider, stepper, popup, combo box, and a 40-row table in a
  scroll view. Every control is inert and mutates only its own state, so the catalog can be driven
  without pressing buttons or overwriting text in the user's applications;
- `bimax-cu-service --self-test-catalog`, wrapped by `scripts/conformance-bimax-cu-catalog.sh`,
  attempts every action against the fixture and re-reads the target to confirm a real effect
  rather than trusting the receipt;
- `DeliveryCapabilities.verifiedSemanticActions` carries the proven subset; coordinator capability
  helpers and `assessNativeCutover` gate on it, and a missing field means "nothing proven".

Defects the run found and fixed:

- `expand` was press-only, so it could not expand an `NSComboBox`, which exposes a settable
  `AXExpanded` and no `AXPress`. Now prefers the settable attribute;
- `select` was press-only, so it could not select an `NSTableView` row, which exposes a settable
  `AXSelected` and no `AXPress`. Now prefers the settable attribute.

Confirmed platform limitations, left advertised but unverified:

- `AXScroll*ByPage` is advertised and inert across AppKit, SwiftUI, Electron, and a plain
  `NSScrollView`; AppleScript reports success for the same call while the scroll bar does not move;
- AppKit table rows do not advertise `AXScrollToVisible`.

### Checked multi-edit and atomic multi-select transactions

Date: 2026-08-01

Phase 4 slice 5. The native service now accepts a deliberately narrow semantic transaction:
one to five `set_value`/`set_selected` steps, all authorized by the same retained snapshot and exact
PID/window generation, under `background_native` or `background_only` only.

- the coordinator-provided SHA-256 manifest is recomputed from the canonical based-on, policy, and
  steps payload before any live target work;
- step ids, target identity, action subset, payload shape, secure-field policy, and all declared
  preconditions are checked for the whole manifest before step one can mutate;
- the event epoch and exact window are rechecked immediately before every delivery;
- multi-edit runs in declared order. A later refusal returns `outcome: stopped`, the exact completed
  prefix, `stoppedBeforeStepId`, and the native error. It never returns a top-level error that hides
  partial completion;
- successful and potentially dishonored batches consume the retained target authority.

The first live run overturned another assumption: sequential row-level `AXSelected=true` writes do
**not** accumulate in AppKit, even when `NSTableView.allowsMultipleSelection` is true. The second
write replaced the first and the harness correctly failed `effectsObserved`. Multi-select now
writes the container's complete `AXSelectedRows` (or `AXSelectedChildren`) array once and re-reads
every requested row before issuing receipts. This is atomic at the native primitive rather than a
control-click approximation.

Conformance: both two-step templates delivered through the full service path and both final effects
were re-observed. The offline suite is 39/39. General transactions — mixed action types,
foreground approvals, postconditions, commit boundaries, and coordinator compilation — remain
Phase 6 work rather than being implied by this capability.

### App-owned foreground activation broker

Date: 2026-08-01

Phase 4 follow-up, completed. The long-lived service remains unable to take foreground by
itself. The desktop app now publishes a loopback-only, random-token broker to its coordinator child;
an initial activation is accepted only while the Bimax window is focused, while a bounded return
grant allows `foreground_once` to restore that exact Bimax PID after the target takes the front.
Broker refusals never fall through to the ineffective in-service activation routes.

The broker launches one bounded helper mode of the packaged native binary. That fresh child checks
the PID/bundle pair, makes the exact Process Manager request, and observes the exact front PID before
returning. This is deliberately different from the rejected long-lived-service bridge documented
below: the child inherits the foreground app's launch context. Front-process observation now uses
the Process Manager query with `NSWorkspace` as fallback, fixing the stale reading exposed by the
first broker run.

Final live desktop conformance is **8/8**: `foreground_once` took the exact fixture PID and restored
the exact Electron PID, while `foreground_persistent` retained the fixture. Electron restoration
now uses the same exact-PID helper as acquisition. The handshake advertises all five verified
policies and derives `focusLease: true` from that evidence.

### Targeted keyboard input: `postToPid` overturns the physical-input blocker

Date: 2026-08-01

Phase 4 slice 4, and a correction to slice 3.

Slice 3 recorded physical input as blocked, reasoning that an event goes to whatever application is
frontmost and that this process cannot control which one that is. **That reasoning only covered
`CGEvent.post(tap:)`, the global stream.** `CGEvent.postToPid` names the recipient process instead.
Measured on macOS 15 with Finder frontmost and the fixture in the background: a virtual keycode and
a `keyboardSetUnicodeString` payload both arrived in the fixture's focused control, and the human's
foreground was never touched.

That makes targeted posting strictly safer than the path the plan assumed:

- the recipient is *named*, not inferred from focus, so there is no window-server race to lose;
- it neither requires nor takes the foreground, so it is unaffected by the slice 1 activation limit;
- it does not compete with the person for the input device.

Delivered:

- `type_text` — Unicode text into one named process, the Phase 4 "Unicode/layout input" task.
  Unlike `set_value`, it produces keystrokes the application's own input handling sees, so
  validation and change notifications fire. It focuses the element through AX first and **refuses
  with `ax_focus_not_honored` when the focus write reports success and the element is not focused**,
  rather than typing into whichever control the application actually had focused. Effect is read
  back from the control, never inferred from the post succeeding;
- `TypedTextReceipt` carries lengths only — the typed text never enters a receipt, exactly as
  selection receipts carry offsets and not content;
- `PhysicalInputMechanism` splits the arbiter's gates. `targeted_process` is implemented; the
  focus-lease, frontmost, and quiet-period refusals apply only to `global_stream`, because they
  exist to compensate for an inferred recipient. Requiring them of a targeted post would guard a
  race it does not have and make Bimax steal a foreground it does not need. `global_stream` remains
  unimplemented — the targeted form does the same job without the inference;
- typing into a secure field stays behind the existing secret refusal. It is the one path that
  would put a real secret into a real keystroke stream.

Conformance: `type_text` verified against the fixture through the full service path —
`deliveryPath: targeted_event`, `honored: true`, effect observed. The catalog is now 14 of 16.

Harness defects fixed in the same pass, both previously found in the focus run and not carried over:

- catalog conformance reported its own generic `observe_failed` instead of the service's error
  code, and pinned one window generation for the whole run. It now re-resolves the window before
  every probe and surfaces the real code — a run where every probe failed had been reporting
  sixteen bare skips;
- the catalog run exited zero when it verified nothing. It now compares against the handshake's
  declared list and fails on any action claimed but not reproduced, the same guard the focus run has.

The escalation contract is now scoped to semantic equivalence. A refused string `set_value`
proposes `recommendedAction: type_text`, `recommendedPolicy: background_only`, rung 4, and no
approval. A selection-range refusal still recommends the same semantic action under
`foreground_once`; a working keyboard path is not falsely advertised as a way to select a range.

### Physical input arbiter, recipient preflight, and the inert targeted-event rung

Date: 2026-08-01

Phase 4 slice 3, as it stood before slice 4. This slice posted no event or moved a cursor; slice 4
later added the process-targeted keyboard path described above.

- `PhysicalInputArbiter` is the gate every physical event must pass, built before the first line of
  CGEvent so physical input is born behind it rather than having one retrofitted. Refusals are
  specific and checkable — `physical_input_not_implemented`, `physical_input_policy_forbids`,
  `physical_input_requires_focus_lease`, `physical_recipient_not_frontmost`,
  `physical_recipient_has_no_focused_window`, `physical_input_human_active` — and every condition
  is evaluated rather than short-circuited, so one round-trip names all the work;
- `RecipientProof` records what was observed at decision time, so a refusal can be explained and an
  allow can be audited;
- human takeover reads `CGEventSource.secondsSinceLastEventType`, which is a timing query and needs
  no Input Monitoring grant. An unreadable idle time counts as the human being active: silence is
  not consent. Whoever adds CGEvent posting must exclude its own event source here, or the arbiter
  will read Bimax's own typing as the human and deadlock itself;
- the arbiter is not decoration: `EscalationProposal.physicalInputAvailable` is derived from it and
  is true only when the current request has an equivalent targeted-keyboard fallback.

The global-stream gate is not theoretical. Slice 1 established that this process cannot make a
target frontmost, and `CGEvent.post(tap:)` goes to whatever *is* frontmost. `recipientNotFrontmost`
is what refuses that path. Slice 4 later avoided the race for typing by naming the process with
`postToPid`; the general/global mouse and keyboard stream remains unimplemented.

Confirmed platform limitation, left unimplemented and unadvertised:

- **rung 4, the targeted non-physical application event, does not exist.**
  `AXUIElementPostKeyboardEvent` is the one AX API designed for it. It is unavailable in Swift
  entirely (deprecated at or before macOS 10.9), reachable only through an Objective-C shim, and
  when reached against the fixture it returned `kAXErrorSuccess` for both key-down and key-up while
  the text field did not change. Fourth "success that changed nothing" in this kit. The remaining
  candidate — per-application Apple Events — is excluded on principle: computer use stays
  app-agnostic, and a per-app event table is not a delivery rung.

Fixture gap closed from the previous slice:

- radio buttons were added so `select` has a control whose first ladder rung is unavailable.
  Conformance now records `ax_attribute:unavailable,ax_action:performed` against `AXRadioButton`,
  which is the live proof that the ladder walks rather than only ever succeeding on rung one.

### Explicit background delivery ladder

Date: 2026-08-01

Phase 4 slice 2. The engine chose its primitive per action by hand, and the ladder existed only for
the two actions catalog conformance had already caught: `expand` and `select`. `toggle`,
`increment`, `decrement`, and `set_selected` were still single-rung, which is the same latent
defect class — a control that answers to only the rung the code did not pick simply fails.

- `DeliveryPath` and `DeliveryAttempt` on the wire; every receipt reports which rung delivered and
  the whole walk, and an escalation proposal reports the rungs it actually exhausted;
- `AXDeliveryLadder.walk` runs a declared ordered ladder. A rung the element does not offer is
  recorded `unavailable` and skipped; a rung that is offered and refused is recorded and the ladder
  continues, so one toolkit's refusal cannot mask a rung that would have worked. All rungs
  unavailable is `actionUnsupported`; some offered and all refused reports the last refusal;
- `toggle` gained an `AXValue` fallback and `set_selected` gained an `AXPress` rung for `true`
  only, since no press deselects;
- ordering stays per action and follows what conformance proved rather than a general rule.
  `toggle` presses first because that runs the control's own handler and the application learns
  about the change; `select` and `expand` write the attribute first because the controls that need
  them advertise no press. Reordering a verified action on a general principle would have been a
  guess;
- `set_value` and the text/scroll actions stay single-rung deliberately: no other rung can set a
  value the caller named, so `ax_value_not_settable` is the honest answer.

Catalog conformance now records the delivering rung per action. Against the fixture every action
delivers on its first rung, so the *fallthrough* path is offline-tested only — no fixture control
currently makes rung 1 unavailable and rung 2 succeed. Worth a fixture control that is press-only
for `select`.

### Focus conformance: delivery policies and the focus lease

Date: 2026-08-01

Phase 4 slice 1. At this point the delivery-policy and focus-lease scaffolding had no physical input
of any kind; slice 4 later added process-targeted keyboard events.

Implementation:

- all four §7.1 policies plus `background_native`, the shipped spelling of `background_only`;
- `ForegroundApproval`, bound to one policy and one target. Required by every foreground policy and
  refused on every background one, so an approval cannot ride along on a background call and be
  spent later. The coordinator owns approvals; the service owns the refusal;
- `EscalationProposal` for `background_preferred`, returned instead of an error and only for
  refusals a foreground retry could plausibly change. `semantic_action_unsupported` is excluded:
  running the same call with the application in front cannot conjure an action an element does not
  advertise. At slice 1, `physicalInputAvailable: false` kept the proposal from implying a rung that
  did not exist;
- `FocusLeaseManager` behind an injectable `FocusControlling`, so restore, human-override, and
  expiry branches are testable without moving the real user's focus. A lease cannot outlive its
  request, is released even when the action throws, and is swept on session reset and close;
- `bimax-cu-service --self-test-focus`, wrapped by `scripts/conformance-bimax-cu-focus.sh`.
  `DeliveryCapabilities.verifiedDeliveryPolicies` carries the proven subset and `focusLease` is
  derived from it, so the flag cannot drift from the evidence.

Platform limitation found, left advertised but unverified:

- **This process cannot take the foreground.** From the unbundled service holding Accessibility
  trust on macOS 15, `NSRunningApplication.activate` returns `true`,
  `AXUIElementSetAttributeValue(kAXFrontmost, true)` returns `.success`, and
  `NSWorkspace.openApplication(activates: true)` completes with a nil error — and focus does not
  move for any of them. A `/usr/bin/open -b` control moved focus every time, ruling out a frozen
  session or a target refusing to yield. This is macOS cooperative activation. It is the third
  "success that changed nothing" in this kit. `foreground_once` and `foreground_persistent` are
  therefore unverified; the fix belongs in the frontmost Bimax application, not here.

Follow-up measurement rejected one tempting workaround. The deprecated public Process Manager
pair `GetProcessForPID`/`SetFrontProcessWithOptions` returned success and moved the exact fixture
PID from a standalone Objective-C probe. That result did **not** transfer to the service: isolated
behind a C bridge and called through the full focus-lease path, it returned `noErr` twice while the
WindowServer kept the bystander frontmost and both foreground policies stayed unverified. The
standalone probe inherited a different launch/activation context and was not representative. The
bridge was removed rather than shipping a fourth "success that changed nothing" route.

Defect the run found and fixed:

- `WorkspaceSnapshot.frontmostPid` was the first layer-0 `CGWindowListCopyWindowInfo` row, which is
  whatever overlay sits on top — an `alpha: 0` window, a `CursorUIViewService` input helper — and
  did not change when the frontmost application changed. Filtering to opaque windows owned by
  regular applications just returned a different constant. Now `NSWorkspace.frontmostApplication`,
  which tracked every externally driven focus change, including from a long-lived process with no
  AppKit run loop. This fed `frontmostPidBefore`/`frontmostPidAfter` on every semantic action
  receipt and `AppInfo.active`, so the "foreground evidence" in shipped receipts was wrong whenever
  an overlay topped the window list.

Harness defects found while building it, worth remembering:

- **the run is invalidated by the human using the machine while it runs.** The run alternated
  between passing and failing every check; the cause was focus and window changes made by the
  person at the keyboard during the run, not anything about which application the harness staged.
  A first diagnosis blamed bystander selection and Space switching and was wrong — the mitigations
  it produced (staging Finder, skipping redundant activations, re-resolving the target window
  before every action instead of pinning one generation) are worth keeping for robustness, but they
  were not the cause. The run now detects that the frontmost application is not the one it staged
  and reports `status: "disturbed"` instead of reporting checks that did not really fail;
- the inert fixture now joins all Spaces. This does not revise the corrected disturbance root
  cause above; it only prevents an externally selected Finder Space from turning setup into an
  unrelated `window_not_found` result;
- the `background_preferred` probe depends on an `NSTextField` selection being unsettable while
  unfocused, so it must run before any activation attempt re-keys the fixture window;
- the harness reported its own generic `observe_failed` instead of the service's error code, which
  made a broken check indistinguishable from a broken service.

### Search and window correlation

Date: 2026-07-31

- `ObserveRequest.query` filters emitted nodes by bounded case- and diacritic-insensitive substring
  match over label, value, identifier, and role. It narrows emission only: traversal, scope, and
  authorization are unchanged, and a filtered snapshot records its query so the store refuses to
  diff it against unfiltered state.
- AX window correlation gained a fallback for toolkits whose AX frame differs from the WindowServer
  frame. Electron windows previously failed with `window_not_found`. The fallback accepts a
  candidate only when its center lies inside the target and its area is within 25%, and only when
  exactly one candidate qualifies; ties and title collisions are refused rather than ranked.
- An application exposing zero AX windows still fails closed with `window_not_found`. That is the
  correct answer, not a defect: one browser in the validation sample is genuinely AX-silent.

### `MU-034` / `MU-035` / `MU-036`: AX event epochs

Date: 2026-07-31

Translated behavior:

- one native AX observer per application, with application-level focus/window/structure/property
  notifications;
- when focus changes, register value, selection, layout, and destruction notifications directly on
  the focused control so non-propagating control changes are still observed;
- remove observer sources and registrations when ownership ends.

Bimax additions:

- observer identity is the trusted task-session plus PID, with global and per-session caps;
- callbacks store notification name and increment a monotonic epoch only—no AX content or native
  element is retained as event data;
- capture-before/capture-after checkpoints detect traversal races; raced snapshots are full,
  non-retained, and their tokens cannot become diff bases or action authority;
- reset and close synchronously invalidate all session observers and epochs; missing TCC trust or
  capacity is represented truthfully as tracking unavailable.

Attribution: `AXEventTracker.swift` file header and `THIRD_PARTY_NOTICES.md`.

Tests: stable checkpoints, pre-capture changes, in-capture race invalidation, non-retention, stale
base rejection, and reset/close observer teardown.

### `MU-053`: sibling-owned accessibility labels

Date: 2026-08-08

Translated behavior: the early traversal batch reads `AXTitleUIElement`; when a target has no
human-readable label of its own, the engine reads bounded `Title`/`Value`/`Description` text from
the referenced element.

Bimax additions: direct target metadata always wins, linked text outranks implementation
identifiers/help, and the linked element never receives a token or `ElementRef`. The catalog's
opt-in fixture publishes an empty-title button whose visible sibling owns the name. Live
conformance reports `Linked Fixture Control` on the original `AXButton`; with the dereference
neutered it reports `fixture-linked-button` and exits non-zero.

The earlier compatibility-backend finding that the 40-row table contributes zero elements is a
different gap. Native conformance sees 10 visible rows, 10 named cells, and their static text; the
selectable row objects themselves remain nameless.

License impact: translated from the already-attributed MacOS-Use traversal; MIT notice unchanged.

### `MU-001` / `MU-002` / `MU-003` / `MU-037` / `MU-038`: batched native AX traversal

Date: 2026-07-31

Translated behavior:

- one early `AXUIElementCopyMultipleAttributeValues` call determines role, visibility,
  interactivity, geometry, and traversal children;
- only candidate output elements pay for the late metadata batch and action enumeration;
- traversal is iterative, prunes known non-actionable roles, and supports a lean flash profile.

Bimax additions:

- strict task-session binding and revision counters;
- maximum returned/visited-node budgets, cycle protection, bounded text values, typed errors, and
  no permission prompt on observation;
- Data-only XPC snapshots; native element references never cross the service boundary;
- balanced static-text inclusion and honest full/diff plus event-revision capability reporting.

Attribution: `AccessibilityEngine.swift` file header and `THIRD_PARTY_NOTICES.md`.

Tests: protocol round-trip, session rejection, budget validation, typed snapshot, capability, and
Data-only XPC integration harness.

### `MU-009` / `MU-011`: native workspace identity and geometry

Date: 2026-07-31

Source behavior:

- MacOS-Use separates logical display bounds from physical display pixels and derives scale;
- it uses the ordered WindowServer list for foreground PID because `NSWorkspace` focus can be stale
  without a running AppKit event loop;
- it uses `NSWorkspace` for running application metadata.

Bimax change:

- independently implemented the behavior in Swift with typed protocol records;
- added PID+launch-time application identity and service-owned window generations;
- made inventory read-only and session-bound; normal windows and displays are deterministically
  ordered and no workspace mutation payload is accepted.

Test:

- native wire, capability, session-rejection, typed snapshot, and Data-only XPC transport checks.

License impact: behavior-only; no upstream source copied.

### `HE-010` / `BX-012`: background evidence must not focus

Date: 2026-07-31

Source behavior:

- Hermes distinguishes background and foreground delivery and does not silently foreground.
- Bimax current worktree allowed automatic post-action evidence to call `bring_to_front` even for a
  background `open`.

Bimax change:

- `BimaxComputerRuntime` now records the current delivery contract.
- automatic evidence passes `focusIfBackground` only for foreground delivery;
- background delivery may return degraded AX evidence but cannot steal focus to improve it.

Test:

- `bimax.computer.runtime.test.ts`: background off-screen app window test.

License impact: behavior-only; no source copied.

### `MU-054`: flash GUI prompt plus Bimax exact-state controller

Date: 2026-08-08

Upstream reference: MacOS-Use commit `c88574c0a70534a21e9490e2118f1fce04e16904`,
`macos_use/agent/prompt/system_flash.md`.

Adopted idea: small GUI controllers get a short visible-state → one action → verify playbook instead
of the full desktop operating manual. Bimax independently wrote the prompt text and chooses it for
model IDs at or below 14B, with `BIMAX_COMPUTER_PROMPT=flash|full` as an explicit override.

Bimax additions:

- the production persona and benchmark share one prompt builder, so measured and shipped behavior
  cannot silently diverge;
- explicit exact form requests compile against only the newest semantic state, with expired handles
  forcing a fresh observation and already-satisfied toggles becoming read-only;
- malformed tool JSON is repaired before those user constraints are applied;
- AppKit pop-up selection falls back to one synchronous fresh open-menu/select-item gesture when
  direct AX value assignment exposes no children;
- completion comes only from the newest accessibility values, not the model's claim or driver
  delivery status.

Evidence: `benchmarks/cu-baseline/phase12.6-flash-structured-2026-08-08.json` is one model throughout,
compatibility backend, 15 valid runs, none discarded: form 6/6 at median 2 turns, menu 3/3 at 2,
selection 3/3 at 2, transaction 3/3 at 3. The Phase 10 form/menu medians were 10/7, so the measured
reductions are 80%/71%, both past the 50% exit gate. The grader self-test rejects all five untouched
states. Full Jest: 226/226 executed suites and 2,177/2,177 executed tests.

License impact: idea/behavior only; no upstream source expression copied. Existing MacOS-Use MIT
notice remains sufficient.

## Notice checklist

Before the first translated/copied MacOS-Use or Hermes source lands:

- [x] Confirm/copy the exact upstream MIT text.
- [x] Add copyright holders to `THIRD_PARTY_NOTICES.md`.
- [x] Add file-level attribution where substantial expression is retained.
- [ ] Link the ledger entry from the implementation PR/commit.
- [x] Verify no telemetry or unrestricted command path was carried over.
