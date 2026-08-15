# ADR-002: Bimax_ComputerUse macOS-native architecture

Status: accepted for implementation

Date: 2026-07-31

Decision owners: Bimax engineering

## Context

The current Bimax computer runtime combines:

- a packaged official CUA 0.12.3 binary;
- a long-lived MCP/daemon transport;
- a 6,000+ line TypeScript coordinator;
- a dynamically compiled embedded Swift helper;
- fallback input through cliclick, AppleScript, and xdotool;
- targeting, capture, input, verification, recovery, PiP, recording, window management, and
  task-specific behavior in overlapping layers.

It has strong target correctness and safety behavior, but its default action path is expensive and
its primary native hot path is not owned by Bimax.

The local MacOS-Use, Hermes, and Codex computer-use implementations demonstrate useful complementary
patterns:

- direct batched macOS Accessibility reads and typed controls;
- event-driven native state;
- persistent isolated sessions;
- truthful background delivery;
- capture profiles and optional evidence;
- AX diffs and checked action grouping;
- typed browser routing;
- capability discovery and permission diagnostics.

## Decision

Bimax will build **Bimax_ComputerUse**, shortened to **Bimax-Cu**, as a first-party computer-use
platform.

On macOS, the default backend will become a signed, long-lived Swift/XPC service named
`Bimax-Cu Service`, implemented by the `BimaxComputerUseKit` Swift package.

The TypeScript engine remains the authority for:

- task/session coordination;
- model-facing tools;
- governor approval and taint;
- backend routing;
- transaction compilation;
- evidence policy;
- task/outcome recipes.

The native service owns:

- app/window/display discovery;
- retained AX graph and event observers;
- typed semantic actions;
- target-specific background delivery;
- ScreenCaptureKit capture and streams;
- physical CGEvent arbitration;
- exact-recipient preflight;
- native snapshot diffs and receipts;
- clipboard/files, Spaces, PiP, and recording primitives;
- TCC permission status and doctor checks.

## Naming

| Layer | Name |
|---|---|
| Capability/product | `Bimax_ComputerUse` |
| Short runtime name | `Bimax-Cu` |
| Swift package | `BimaxComputerUseKit` |
| Protocol | `bimax.cu.v1` |
| TypeScript namespace | `bimax_cu` |
| Compatibility model tool | `ComputerTool` |

`ComputerTool` remains a compatibility adapter during migration. Product identity changes before
provider/transcript compatibility names.

## Background-delivery decision

Background delivery is defined as target-specific semantic or browser delivery that does not:

- activate or raise the target app;
- change the human's foreground app;
- move the physical cursor;
- post global physical keyboard/mouse events.

Supported policies:

```text
background_only
background_preferred
foreground_once
foreground_persistent
```

There is no silent escalation from background to foreground.

Physical input always requires an approved foreground path. A temporary foreground path uses a focus
lease and restores the previous app unless the human changes focus during the lease.

## Snapshot decision

The first target observation returns a full pruned AX snapshot. Subsequent observations return
revision-bound AX diffs by default.

Every state-changing action binds to:

```text
session id
pid
window id and generation
target revision
snapshot id
element token or explicit coordinate space
```

Stale or mismatched bindings are refused.

## Transaction decision

Bimax-Cu supports bounded checked transactions of up to five steps initially.

A transaction:

- is expanded and risk-classified before approval;
- discloses every high-impact step;
- validates target and element preconditions before each step;
- stops on invalidation, focus conflict, new risk, failure, or requested checkpoint;
- returns one successor snapshot/diff and per-step receipts.

This replaces the current blanket one-model-turn-per-primitive restriction without allowing blind
batch execution.

## Evidence decision

Every action returns a receipt. Evidence cost is adaptive:

| Tier | Evidence |
|---|---|
| 0 | delivery only |
| 1 | semantic result plus AX event revision |
| 2 | focused-target proof plus AX diff |
| 3 | recipient preflight plus region/AX diff |
| 4 | full target visual and semantic postcondition |

The governor/evidence policy can require a higher tier than the model requested.

## Browser decision

Browser page content routes through Bimax's semantic browser/CDP path. Browser chrome and system
prompts route through macOS AX. Visual-only surfaces route through capture/SOM/physical input.

One task may use multiple surface types, but each action names one exact target.

## Compatibility decision

The current CUA runtime becomes `CuaCompatibilityBackend`.

It remains available for:

- rollback during macOS cutover;
- Linux support until a native Linux backend exists;
- behavior comparison during shadow rollout.

It is removed from the default macOS package only after two stable releases on the native backend.

The embedded Swift helper remains during migration and is retired once the signed service has feature
parity.

## Code reuse decision

MIT-licensed MacOS-Use and Hermes code may be translated or copied only with:

- an exact source/commit entry in `BIMAX_CU_PORTING_LEDGER.md`;
- retained notices in `THIRD_PARTY_NOTICES.md`;
- destination-specific tests;
- adaptation to Bimax target, session, and security contracts.

The proprietary Codex computer-use implementation is not copied. Only its exposed public contract
informs Bimax behavior.

## Consequences

Positive:

- Bimax owns the macOS hot path.
- AX reads and actions avoid unnecessary MCP/base64 overhead.
- true background work becomes explicit and testable.
- per-session state permits concurrent read-only tasks.
- semantic actions can use lightweight receipts.
- model round trips and repeated observation payloads fall substantially.
- signed deployment gives one stable TCC identity.

Costs:

- Bimax must maintain a native Swift service.
- XPC, code signing, TCC, and macOS integration testing become release responsibilities.
- native/backend parity requires a multi-release migration.
- the AX graph and diff engine require careful event-loss recovery.

## Rejected alternatives

### Continue expanding the current TypeScript runtime

Rejected because it cannot optimize the opaque CUA hot path and further increases responsibility
concentration.

### Replace Bimax with MacOS-Use

Rejected because MacOS-Use lacks Bimax's exact-window/frame safety, recipient preflight, structured
verification, approvals, and user-takeover behavior.

### Adopt Hermes's wrapper wholesale

Rejected because it preserves CUA as the primary architecture and imports a large compatibility
surface Bimax is trying to leave.

### Require one model turn per primitive permanently

Rejected because checked native transactions can preserve approvals and stale-state safety while
removing avoidable inference round trips.

### Allow background requests to focus silently for evidence

Rejected because focus change is user-visible and violates the meaning of background execution.

## Implementation gate

No native-default rollout occurs until:

- protocol and target invariants pass;
- background focus-theft rate is zero in the test matrix;
- stale-state and wrong-recipient tests pass;
- held input is neutral after failure/cancel/takeover;
- latency budgets pass;
- signed updates preserve TCC behavior;
- CUA rollback remains available.
