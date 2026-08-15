# Bimax-Cu security model

Status: Phase 2 foundation

Date: 2026-07-31

## Trust boundaries

- The TypeScript coordinator owns user intent, approvals, taint policy, task identity, and backend
  selection.
- `Bimax-Cu Service` owns native observations and delivery but never decides that an action is
  authorized.
- Applications, windows, accessibility text, pixels, clipboard data, and browser content are
  untrusted observations.
- A Bimax task receives one isolated service session. Targets, snapshots, element references,
  recording ownership, and recovery generations never cross sessions.

## Protocol rules

- Only the versioned Codable `bimax.cu.v1` data envelope crosses XPC.
- Incompatible protocol versions, malformed payloads, invalid deadlines, unknown sessions, and
  session-id collisions fail before mutation.
- Session reset advances its generation and invalidates target/snapshot state.
- Capability negotiation is fail-closed: the service advertises only implemented and tested
  features. The Phase 2 foundation intentionally reports native AX/capture/input as unavailable.
- Advertising is separated from evidence. `semanticActions` is what the service will attempt;
  `verifiedSemanticActions` is the subset proven to have a real effect against a live
  Accessibility server by the catalog conformance run. Coordinator capability checks and the
  cutover assessment both gate on the verified list, so an action that is accepted but inert
  cannot be mistaken for a working one.
- The service accepts no arbitrary shell, AppleScript, JavaScript, selector name, or executable
  payload.

## macOS identity and permissions

- The Electron distribution embeds `BimaxCuService.xpc` under `Contents/XPCServices` so the nested
  service is signed with the containing Bimax app.
- The single-file TUI embeds the same binary and exposes its extracted path to the engine, but does
  not launch or route to it yet.
- Status probes call `AXIsProcessTrusted` and `CGPreflightScreenCaptureAccess`; they never open a
  permission prompt.
- The service rejects callers that fail the configured signing requirement. Requirements are bound
  to the current process's Developer ID team as well as an allowlisted identifier; identifier plus
  Apple anchor alone is not accepted. On macOS 13+, both
  ends install `NSXPCConnection` code-signing requirements, which Foundation evaluates against the
  immutable audit token on each message. The PID-based Security check is defense in depth and the
  macOS 12 fallback.
- Unsigned local development is rejected by default. `BIMAX_CU_ALLOW_UNTRUSTED_CLIENT=1` permits
  only a same-user client and is an explicit development-only override.
- Ad-hoc sealing is reported as `serviceSigned: false`; a bundle identifier alone is not treated as
  a production signing identity.
- `BIMAX_CU_ALLOW_UNSIGNED_SERVICE=1` is the matching same-user development override for the
  *service* signing requirement, added 2026-08-02. It exists because a local checkout cannot produce
  `serviceSigned` at all — `PermissionDoctor.swift` computes it as `identifier != nil && !adHoc` —
  so without it the native path is untestable by the person developing it until they buy a
  Developer ID. Scope, deliberately narrow:
  - it clears only the signing blocker, and replaces it with the advisory blocker
    `service_unsigned_development_override`, which stays in every assessment so no status line or
    receipt can imply the run was signed;
  - it never clears a MEASURED blocker. `capture_unavailable`, `physical_input_unavailable` and
    `focus_lease_unavailable` come from the live handshake, and an environment variable must not be
    able to invent a capability;
  - it does not imply `routing_gate_disabled`, and it does not touch the XPC client or signed-
    ancestor checks — a bridge still needs `BIMAX_CU_ALLOW_UNTRUSTED_CLIENT=1`;
  - it requires exactly `"1"`; `true`/`yes`/`2` do not enable it, so it cannot be reached by a stray
    shell export.

  It is a real reduction in assurance: an unsigned binary in the expected path becomes trusted. That
  is acceptable for a developer running their own build on their own machine and unacceptable in
  anything distributed. Never set it in packaging, CI release jobs, or a signed artifact.
- **User-approved ad-hoc service** (added 2026-08-07). Developer-ID answers two questions at once —
  *who made this?* and *has it been altered since?* — so requiring it means a build whose author has
  no Apple Developer account cannot use the native path at all, however intact it is. This answers
  the second question by measurement and asks the user to stand in for the first. It is a distinct
  mechanism from `BIMAX_CU_ALLOW_UNSIGNED_SERVICE`, which verifies nothing and stays
  development-only.

  `PermissionDoctor` now VERIFIES the seal rather than only reading the identity it claims:
  `SecStaticCodeCheckValidity` plus the code directory hash, reported additively as `adHocSigned`,
  `signatureIntact` and `codeDirectoryHash` (all optional, so a missing field can never read as a
  satisfied check). Until this, `serviceSigned` recorded *who signed* and nothing ever checked
  whether the signature still covered the bytes on disk.

  `assessAdHocServiceTrust` requires BOTH an intact signature AND a hash matching the user's
  recorded approval. Measured on a real ad-hoc binary, 2026-08-06, and this is why neither is
  sufficient alone — one byte was flipped mid-binary:
  - `signatureIntact` went `true` → `false` (`errSecCSSignatureFailed`, -67061);
  - `codeDirectoryHash` did **not** change, because it is read out of the signature blob rather than
    recomputed from the file. Alone it is a claim the binary makes about itself.

  So hash-only would admit a tampered binary that kept its blob, and intact-only would admit any
  binary an attacker re-signed ad-hoc — which anyone can do for free, with no account.

  Scope, deliberately narrow, matching the existing override's rules:
  - it yields the advisory blocker `service_ad_hoc_user_approved`, which stays in every assessment,
    so no status line or receipt can imply a production identity;
  - it never clears a MEASURED blocker — consent speaks to provenance, and cannot approve a
    capability into existence;
  - approval is recorded per exact `codeDirectoryHash`, so replacing or updating the binary revokes
    it and requires a fresh, informed opt-in;
  - it is never an environment variable. Any process able to set the environment could forge one.

  **What it does not establish is PROVENANCE.** Nothing here proves who built the binary — that is
  precisely the property Developer-ID provides and this cannot — so the consent prompt must say so
  plainly rather than implying the code was vouched for by anyone.

  **Recording consent** (completed 2026-08-07). `/computer trust-service` probes the service afresh
  — never a cached handshake, since the point is to approve the bytes running now — and shows the
  full hash, the binary path, and what approval does and does not prove. Approval is a second,
  explicit step that must name the hash the user was shown (`/computer trust-service approve
  <hash>`) and is refused if the service no longer reports it: re-signing ad-hoc is free, so between
  the disclosure and the confirmation the binary could have been swapped for another perfectly
  intact one. `/computer trust-service revoke` withdraws it.

  Two states are refused rather than offered: a service with no signature at all (no seal, so
  nothing an approval could pin), and one whose signature does not cover the bytes on disk. The
  second is deliberately not approvable — the binary no longer matches its own seal, so whatever the
  user believes they are approving, it is not that.

  The record lives in `~/.breakglass/computer-service-approval.json` (relocatable with
  `BIMAX_BREAKGLASS_DIR`), owner-only, written atomically, and deliberately NOT in `config.json`:
  the config loader composes an `ENV_OVERRIDES` table mapping keys to environment variables, and an
  approval stored there would be one table entry away from being forgeable by any process that can
  set the environment. Reading it is stricter than reading a preference — a symlink, a foreign
  owner, or a group/world-writable mode are refused rather than repaired, because chmod-on-read
  cannot un-plant a record that is already on disk. Every failure mode (absent, corrupt, unsafe,
  malformed hash) yields no approval, so the service is simply not trusted.

  One approval is kept, not a list: a set of them would let a service fall back to an older approved
  hash, and replacing keeps the precise "changed since it was approved" refusal reachable. The
  record is read per probe, so approving or revoking takes effect without a restart, and it is
  carried on the probe result so that discovery, the live bridge assessment, the status hub, and the
  UI snapshot all assess against the same record instead of racing separate reads. The live bridge
  handshake is re-assessed with it: discovery clearing on the approved sidecar says nothing about
  whatever the bridge turns out to be.
- Permission requests will be explicit protocol operations and remain coordinator-approved.
- The packaged `bimax-cu-bridge` is the only engine-to-XPC adapter. It revalidates a signed Bimax
  app in its live ancestor chain for every request, preventing an unrelated process from spawning
  the shipped bridge as a confused deputy. The XPC service has no direct stdio action endpoint.

## Workspace inventory

- `workspace.snapshot` requires a live task session even though it is read-only.
- Frontmost ownership comes from the ordered WindowServer list, avoiding stale `NSWorkspace`
  focus state in event-loop-free helpers.
- App refs include PID plus launch time; window refs include a service generation; display records
  distinguish logical points from physical pixels and Retina scale.
- Inventory accepts no launch, focus, input, file, URL, Apple Event, or shell payload.

## Application resolution and launch

- An application is named by bundle identifier or display name. `AppLookup` has no path case, and
  path-shaped, control-character, over-length, and dot-prefixed lookups are refused in both the
  coordinator and the service. The protocol therefore cannot express "execute this binary", and a
  caller cannot reach a bundle Launch Services has not registered.
- Launch uses `NSWorkspace.openApplication(at:configuration:)` with activation, recents, new
  instances, and user prompts all disabled. There is no `open(1)` subprocess and no deprecated
  activating fallback.
- Opening a running application raises it, so an already-running bundle ends the request without an
  open. A background launch cannot become a foreground change by way of a second request.
- The receipt measures the frontmost PID before and after the call and derives `frontmostChanged`
  from those measurements. A launch that moved the human's foreground is reported, never concealed,
  and a forged wire value cannot override the measurement.
- Readiness is read from the launched process, not inferred from the open call returning.
- `verifiedOperations` gates model exposure exactly as `verifiedSemanticActions` does. Only
  `bimax-cu-service --self-test-app-workspace` may add to it, and that run fails if the handshake
  claims an operation it could not reproduce.
- Launch is not routine work: `BimaxWorkspaceTool` resolves first and then takes a COMPUTER_CONTROL
  decision naming the resolved bundle path and identifier, so an approval cannot be obtained for a
  name and spent on whatever that name later resolves to.
- An interrupted launch is never automatically replayed; the process may already exist.

## Window operations

- A window mutation names an exact PID, WindowServer id, and service-issued generation. The service
  re-reads the live inventory and refuses a reissued id (`window_generation_stale`) before any
  Accessibility call: WindowServer reuses window ids, and a reissued id is a different window.
- `honored` is computed by reading the window back. `AXUIElementSetAttributeValue` returns
  `.success` and ignores the write on several toolkits, and applications legitimately clamp
  geometry, so the applied bounds are always reported and nothing is retried.
- Minimize walks a bounded ladder (settable attribute, then the window's own button). Unminimize
  has no second rung and says so rather than inventing one.
- Layout presets are computed from the display's measured usable bounds and delivered as an
  ordinary frame. A display with no measured usable area produces no layout; the full display
  rectangle is never substituted. The preset resolves against the display the window is on, not one
  the caller named.
- `close_window` is the only window operation marked high-impact: it can discard unsaved work.
- Measured and left unverified: an application launched without activation can expose zero AX
  windows while presenting a real WindowServer window; `AXMinimized` is unsettable and
  `AXMinimizeButton`'s advertised `AXPress` is inert on AppKit; `close_window` reproduced in
  isolation but not through the harness with multiple AX windows. None of the three is claimed.

## File and URL operations

- Every path is resolved against the active workspace with the same lexical plus realpath rule the
  governed download destination uses, so a symlink cannot carry an operation out of the workspace.
  The native service additionally requires an absolute, already-normalized path and never expands
  `~`, resolves a relative path, or re-normalizes — normalizing there would mean the coordinator
  validated one path and the service acted on another.
- Trash refuses `/`, the home directory, any ancestor of it, and system-owned prefixes *before* it
  asks the filesystem anything, so the refusal cannot vary with what happens to exist.
- Deletion is recoverable and provable: `FileManager.trashItem` reports where the item landed, and
  the receipt carries that path.
- Trash and duplicate cross the FILE_WRITE boundary as destructive operations; open, reveal, and
  URL opening take a COMPUTER_CONTROL decision. Every approval names the resolved absolute path or
  host, never the model's input string.
- Revealing a file brings Finder forward. It declares `requestedActivation: true` and is disclosed
  as high-impact rather than presented as a background read.
- Only `http` and `https` URLs are expressible. A custom scheme is a request to run whichever local
  application claims it, and is refused in the coordinator and again in the service.
- An `open_file` handler is resolved through the same Launch Services path a launch uses, so it
  cannot reach a bundle a launch would refuse.
- `reveal_file` and `open_url` are implemented and advertised but **not** live-verified, because
  measuring them would commandeer the machine the run is on. They are therefore absent from the
  model-facing enum.

## Retained Accessibility state

- AX snapshots are retained only inside their trusted task session, with a default four-snapshot
  bound; reset, close, and eviction invalidate all associated element refs.
- Random element tokens are authorization handles. Deterministic path hashes are equality/diff keys
  and are never sufficient to authorize an action.
- Diff bases must match session, PID, exact window generation, and perception profile. Missing or
  mismatched bases fail with typed errors; oversized diffs fall back to complete state.
- No native `AXUIElement` reference enters the graph/snapshot store or wire format. The observer
  tracker retains only its application registration handle for deterministic teardown. Future
  actions must resolve a path against live AX state and re-check role, identity, geometry, target
  generation, and revision.
- AX observers are owned by session and PID, capped globally and per session, and removed from the
  run loop on reset/close. Callbacks retain notification metadata only; they do not copy user
  content into an event stream.
- Every capture brackets traversal with observer checkpoints. A changed epoch forces full,
  non-retained evidence, so capture-raced refs cannot become diff bases or action authorities.
- Missing TCC trust or observer capacity is explicit as `eventTracking: false`; callers must not
  interpret an unchanged revision as proof of stability when tracking is unavailable.

## Semantic action authorization

- The first native mutation slice accepts exact-window, generation-bound refs only. PID-only refs
  are observation evidence, not action authority.
- Every action requires the snapshot event revision and live observer tracking. The service checks
  the epoch before re-resolution and again immediately before mutation.
- Live re-resolution is a bounded tree walk and must match path hash, role, optional
  subrole/identifier, enabled state, and geometry. No stored `AXUIElement` is reused.
- Only a fixed semantic catalog maps to AX primitives. Arbitrary action/attribute names, focus,
  raise, global events, cursor movement, and coordinate fallback are not accepted.
- String values are bounded, non-finite numbers and NUL-containing strings are rejected, and secure
  fields require a future secret-specific approval flow.
- Successful actions invalidate all retained refs for the exact target. Mutation requests are never
  retried automatically after an XPC interruption.
- Receipts record event epochs and frontmost PID before/after. Native background delivery avoids
  explicit activation but does not conceal recipient-driven foreground changes.

## Text selection, caret placement, and page scrolling

- Text and scroll actions are not a second authorization path. They enter the same pipeline: live
  task session, retained random token, exact snapshot binding, exact PID and window generation,
  authorizing observer revision, current observer revision, bounded live rewalk, stable-path match,
  role/subrole/identifier/geometry comparison, and a final checkpoint immediately before mutation.
- Role, secrecy, and payload policy is evaluated before any live Accessibility call, so a malformed
  or out-of-catalog request never reaches a real element. Action and payload must pair exactly.
- Secure roles and subroles are refused for selection, caret placement, and scrolling, not only for
  value writes. A secure field's selection state is still a lever over its contents.
- Character offsets are UTF-16 code units and must fit the live document. `AXNumberOfCharacters` and
  `AXValue` are both consulted; when they disagree the smaller bound wins, and when neither is
  readable the request fails instead of assuming an empty document.
- Exact-text selection refuses ambiguity. Zero matches and more than one surviving match are both
  errors; the service never resolves a selection by ranking candidates. Needles and searched
  documents are size-capped so a hostile control cannot turn a selection into an unbounded read.
- Scrolling uses either the element's own advertised `AXScroll*ByPage` action or the container's
  scroll bar `AXValue`. No scroll-wheel event, pointer movement, coordinate targeting, or
  repeated-page expansion exists on either path. `AXScroll*ByPage` is advertised-but-inert across
  AppKit, SwiftUI, and Electron, so it fails with a typed refusal naming the `AXError` instead of
  being reported as a successful scroll.
- Receipts and errors carry offsets, counts, and scrollbar percentages only. Selected text,
  surrounding text, element values, and the caller's own match needles are never echoed back.
- A successful selection or scroll consumes every retained authority for the exact target. This
  matters most for scrolling, which invalidates the geometry the authorizing snapshot described.
- Unreadable scrollbar positions are reported as unknown, never as proven movement.

## Search, capability discovery, and applied-effect evidence

- `query` is an emission filter, not an access control change. It narrows which nodes are returned;
  it never widens traversal, escapes scope, or grants authority a caller did not already have.
  Queries are bounded to 256 characters and reject blanks and NUL.
- A query-filtered snapshot records its query. The store refuses to diff a filtered view against
  unfiltered state, which would otherwise report every non-matching node as removed.
- `settableAttributes` and `patterns` are read from the live element, never from a per-application
  or per-bundle table. Settability is probed only for the four attributes Bimax-Cu can act on.
- Capability data is advertisement, not authorization. A node claiming the `text` pattern still
  passes the full token/snapshot/generation/epoch/rewalk/checkpoint pipeline before any mutation.
- Selection receipts re-read the applied range after the write and report `honored`. Some toolkits
  return success from `AXUIElementSetAttributeValue` and ignore the write entirely — observed live
  on an Electron text area, where every requested selection silently resolved to `(0,0)`. Treating
  the AX return code as proof would have reported those as successful selections.
- Window correlation accepts a relaxed geometry candidate only when exactly one qualifies. Ambiguity
  is refused, never ranked, so a fallback cannot silently bind the wrong window.

## Scoped and partial observation

- Window observations correlate PID/window identity first, then clip every emitted rectangle to the
  live AX window. Fully off-window subtrees do not become model-visible or actionable refs.
- System UI traversal uses a fixed bundle allowlist: Dock, Control Center, SystemUIServer, and
  Spotlight. Allowlisted PIDs must use `system_ui`; an arbitrary accessory/helper process cannot.
- AX whole-call failures are aggregated by typed code and stage. No labels, values, or exception
  payloads are copied into diagnostic messages.
- A per-request capture budget is checked between AX calls, in addition to the native per-call
  messaging timeout. Timeout/root failures become explicit partial evidence where a target identity
  is still known.
- Partial, truncated, or capture-raced snapshots are never retained, diffed, or accepted as action
  authority. An empty or budget-limited graph therefore cannot be interpreted as proof that an app
  has no controls.

## Cutover blockers

Native routing must remain disabled until all are true:

1. a real Developer ID/notarized package passes both code-signing requirements on a clean Mac;
2. operation-specific tools adopt the packaged bridge/XPC path (**implemented**; model registration
   is the macOS default but remains inactive unless every structural cutover gate passes);
3. AX, capture, semantic input, physical input, and receipt modules pass parity/security tests;
4. background mode proves zero activation, cursor movement, and global event posting;
5. recording and clipboard scopes are session-owned and approval-bound;
6. malformed/fuzzed protocol input cannot crash or mutate the service.

These are enforced in code, not only in this document. `assessNativeCutover` in
`src/computer/native.service.client.ts` recomputes eligibility from the live handshake on every
probe and returns the specific blockers. `BIMAX_CU_NATIVE_ROUTING_ENABLED=1` clears exactly one
blocker (`routing_gate_disabled`) and is necessary but never sufficient. Capture and focus lease are
now live-proven; full replacement still reports `physical_input_unavailable` (and an unpackaged
development binary reports `service_not_signed`). A growing semantic catalog does not move this
full gate — `/computer` shows the outstanding blocker count next to the service status.

Phase 9 also has a narrower additive gate, `assessNativeSemanticOptIn`. It is the signed macOS
default in 1.1.0 and can be overridden through `/computer backend` or
`BIMAX_CU_NATIVE_ROLLOUT_MODE`. It inherits signing, TCC, AX diff/event, verified
semantic catalog, capture, and focus-lease checks and removes only the global physical-input check.
The exposed native tools have no raw pointer/key operation, and the compatibility `ComputerTool`
stays registered as the physical-input owner and rollback path. Discovery and the live bridge are
assessed independently; this gate cannot authorize a weaker endpoint from a stronger cached probe.

`NativeRolloutController` adds deterministic cohorts and a persistent no-content circuit breaker.
It retains only coarse tool names, timestamps, redacted error codes, and outcome counts. Ambiguous
timeouts/correlation faults stop future native delivery immediately; ordinary availability faults
trip a rolling budget. The failed operation is never replayed through compatibility.

`BIMAX_CU_NATIVE_SHADOW_ENABLED=1` is narrower again and remains read-only. Shadow eligibility
requires signing, Accessibility trust, application/window scopes, AX diffs, event revisions, and a
bounded profile, but no acting/capture capability. It runs only after the compatibility observation
has completed, is fire-and-forget from `ComputerTool`, has a global concurrency cap of two and a
one-read-per-task cap, and never queues excess work. Its 64-entry receipt ring stores aggregate
counts/digests and redacted codes only. The model-visible compatibility result contains no shadow
field and is unchanged whether the shadow agrees, diverges, times out, or is unavailable.
