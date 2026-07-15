# Protocol change proposal — optional per-turn `perf` timing event

Status: **proposed, not implemented on the wire.** The engine-side timing points already exist
(`src/telemetry/perf.ts`) and are surfaced via `/perf`. This proposal is only about whether the
front-end wants them pushed as a structured event so the renderer can separate *its* latency from the
provider's. Per the ownership boundary, the Go consumer is not changed until the front-end owner
accepts this.

## Motivation

P0-3 requires that renderer latency be separable from provider latency. The engine now records, per
turn: input-received → routing-complete → context-assembly-complete → provider-request-started →
first-raw-provider-chunk → first-visible-token → stream-complete (all monotonic). Today these are
only visible through `/perf`. A front-end that wants to show/attribute latency live would benefit from
receiving them per turn.

## Proposed event

Additive, optional, ignorable by any existing consumer (no version bump required — unknown `t` values
are already skipped by both the Go TUI and the Electron app):

```jsonc
{
  "t": "perf",                 // new outbound event type
  "lane": "lite" | "full",     // which turn lane ran
  "model": "stepfun-ai/step-3.7-flash",
  "overheadMs": 42,            // Bimax work before the provider request
  "providerWaitMs": 830,       // provider request → first raw chunk (NOT our latency)
  "renderMs": 6,               // first raw chunk → first visible token (our filter/emit path)
  "totalMs": 1210
}
```

Emitted once per turn, right after `stream complete`, immediately before the turn's terminal
`spinner_state: idle`. It carries **timings only** — never prompt or response text — so it is safe to
log and forward (same secret-free guarantee as the persisted `perf.jsonl`).

## Compatibility

- Purely additive: front-ends that don't handle `t: "perf"` ignore it, exactly as they ignore any
  unknown event. No `PROTOCOL_VERSION` bump.
- The data is already computed; wiring is a single `this.write({ t: 'perf', ... })` in the host from
  the `TurnBreakdown` that `endTurnTimeline()` returns.

## What the engine will NOT do unilaterally

- No change to the Go consumer (`tui/**`) — that is the front-end owner's to accept and implement.
- No presentation-side stream pacing changes; this is data only.

If the front-end does not want this event, no action is needed — `/perf` continues to expose the same
numbers on demand.
