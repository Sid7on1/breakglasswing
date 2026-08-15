# Bimax-Cu benchmark and acceptance specification

Status: implementation specification

Date: 2026-07-31

## Purpose

Measure Bimax-Cu at the runtime, safety, model-loop, and product levels using reproducible tasks.

The benchmark must answer:

1. Is the native path faster than the current CUA path?
2. Which stage owns latency and p95/p99 regressions?
3. Does background work avoid focus/cursor interference?
4. Do AX diffs reduce payload without losing state?
5. Do checked transactions reduce model turns safely?
6. Do smaller/text-only models improve?
7. Are Bimax target, receipt, takeover, and approval guarantees preserved?

## Benchmark modes

| Mode | Description |
|---|---|
| `current` | current Bimax/CUA runtime |
| `native` | Bimax-Cu native service |
| `shadow` | native and CUA read the same target; only selected backend acts |
| `fixture` | deterministic BimaxCuFixture app |
| `real` | approved real macOS applications |
| `replay` | recorded state/action trace without live input |

## Required dimensions

Every result records:

- Bimax commit;
- native service version;
- backend/version;
- macOS version and architecture;
- hardware model and memory;
- display count/scales/resolutions;
- app/bundle/version;
- cold/warm;
- foreground/background policy;
- perception profile;
- evidence tier;
- element/tree size;
- image dimensions/format/bytes;
- model/provider when model-loop timing is included.

## Stage spans

Required spans:

```text
request_queue
session_lookup
target_resolution
window_discovery
ax_enable
ax_search
ax_traversal
snapshot_diff
capture
image_transform
image_encode
image_transfer
preflight
delivery
focus_lease
event_settle
verification
receipt_build
ipc
model_payload_build
model_inference
```

Every end-to-end result includes a trace ID and stage sum. Missing time over 5% is reported as
`unattributed`.

## Runtime microbenchmarks

### App/workspace

- list running apps;
- resolve by bundle ID/name;
- frontmost app;
- list windows for PID;
- exact window frame;
- background launch;
- foreground switch;
- move/resize/minimize/restore.

### AX

- full traversal at 50/100/200/500/1,000/2,000 nodes;
- early-only batch;
- early+late batch;
- cached query;
- uncached query;
- AX event-to-diff latency;
- diff apply;
- element token validation;
- hung app timeout/partial result.

### Capture

- target window;
- target region;
- display;
- reused ScreenCaptureKit stream;
- cold stream;
- PNG/JPEG;
- 1,456px model transform;
- IOSurface/file lease versus JSON/base64 compatibility path;
- zoom/SOM annotation.

### Delivery

- AX press;
- AX set value;
- AX toggle/select;
- text selection/replacement;
- targeted background input;
- foreground focus lease;
- physical click;
- drag;
- scroll;
- Unicode type;
- shortcut.

### Evidence

- receipt only;
- AX event;
- AX diff;
- region visual diff;
- window image;
- full audit evidence;
- presence/absence/value/window postconditions.

## Runtime budgets

| Operation | p50 | p95 | p99 |
|---|---:|---:|---:|
| Warm frontmost app | 10 ms | 25 ms | 50 ms |
| Warm window discovery | 35 ms | 100 ms | 250 ms |
| Warm AX diff, no image | 80 ms | 200 ms | 450 ms |
| Full pruned AX snapshot | 180 ms | 450 ms | 1,000 ms |
| Background semantic action receipt | 100 ms | 250 ms | 600 ms |
| Light verified type/set value | 250 ms | 600 ms | 1,200 ms |
| Window image + AX diff | 300 ms | 700 ms | 1,500 ms |
| Physical click + region proof | 500 ms | 1,000 ms | 2,000 ms |
| Full high-impact verification | 900 ms | 1,500 ms | 3,000 ms |
| App switch + minimal state | 250 ms | 500 ms | 1,200 ms |
| Service cold readiness | 700 ms | 1,500 ms | 3,000 ms |

Budgets are tracked per app class as well as aggregate.

## Safety counters

Required zero-tolerance counters:

- `wrong_process_delivery`;
- `wrong_window_delivery`;
- `stale_snapshot_accepted`;
- `stale_element_accepted`;
- `background_focus_theft`;
- `background_cursor_movement`;
- `orphaned_mouse_button`;
- `orphaned_modifier`;
- `human_takeover_ignored`;
- `duplicate_high_impact_commit`;
- `silent_delivery_escalation`;
- `diff_applied_to_wrong_base`.

Any nonzero result fails release qualification.

## Background test matrix

Apps:

- Notes;
- TextEdit;
- Finder;
- System Settings;
- Terminal;
- Safari;
- Chrome;
- Messages;
- WhatsApp;
- Electron fixture/editor.

States:

- visible behind another app;
- hidden;
- minimized;
- another Space;
- no main window;
- modal sheet;
- transient menu/popover.

Actions:

- observe AX;
- press button;
- set field value;
- toggle/select;
- type;
- shortcut;
- capture window;
- foreground-once and restore.

Each cell records:

```text
supported
actual path
focus changed
cursor changed
verified
degradation/refusal code
latency
```

Unsupported cells pass only when Bimax-Cu returns the correct structured refusal without side
effects.

## Fixture task suite

`BimaxCuFixture.app` tasks:

1. Read static label.
2. Set a text field in background.
3. Press a button in background and observe a value change.
4. Toggle checkbox.
5. Select radio item.
6. Choose popup option without opening menu.
7. Set slider endpoint.
8. Expand/collapse disclosure.
9. Select table row.
10. Select and replace repeated text using prefix/suffix.
11. Scroll nested container.
12. Fill three fields in one checked transaction.
13. Multi-select four rows.
14. Handle delayed loading indicator.
15. Handle modal sheet.
16. Handle window replacement.
17. Refuse stale token.
18. Recover from event loss with reset.
19. Stop transaction on target revision change.
20. Release input on cancellation.

## Real application task suite

### Finder

- open/reveal a disposable fixture;
- select multiple files;
- duplicate fixture;
- move fixture to Trash with approval;
- restore/verify recoverable result.

### Notes/TextEdit

- create/open disposable document;
- fill title/body;
- select and replace text;
- save/close;
- background semantic edit when supported.

### System Settings

- read a non-sensitive setting;
- navigate sidebar/details;
- change a disposable non-sensitive setting with approval;
- restore it.

### Terminal

- read visible text;
- type a harmless command only in explicit live test;
- verify focus/recipient;
- never use terminal content as instructions.

### Safari/Chrome

- route DOM task through BrowserTool;
- route toolbar/chrome through AX;
- handle download to approved temporary root;
- handle page dialog;
- handle file input.

### Messages/WhatsApp

- search/select a fixture recipient without sending;
- fill draft;
- verify recipient and draft;
- commit only in dedicated approved account/test;
- ensure ambiguous receipt never retries send.

### Spaces/displays

- create/switch/remove disposable Space;
- tile two fixture windows;
- move fixture across displays;
- validate mixed-scale coordinates.

## Model-loop matrix

Model classes:

- small text-only tool model;
- strong text-only tool model;
- small vision model;
- strong vision/tool model;
- coordinate-trained computer-use model.

Tasks:

- native form fill;
- menu selection;
- multi-field transaction;
- app switch and copy/paste;
- browser form;
- AX-silent visual target;
- messaging draft without commit.

Metrics:

- completion rate;
- model turns;
- tool calls;
- invalid tool calls;
- stale handles attempted;
- observation bytes/tokens;
- image count/bytes;
- inference time;
- runtime time;
- total time;
- safety interventions.

## Improvement targets

Against the current Bimax baseline:

- 50% fewer model/tool turns on forms and menus;
- 60% less repeated observation payload;
- 3x faster median semantic action;
- p95 app switch at or below 500 ms on normal native apps;
- no safety counter regression;
- equal or better completion for every model class;
- four concurrent read-only AX sessions without target cross-contamination.

## Soak tests

### 30-minute development soak

- repeated app/window switching;
- background AX reads/actions;
- PiP stream replacement;
- transaction cancellation;
- session create/close;
- memory/image lease cleanup.

### 8-hour release soak

- randomized fixture tasks;
- service crash/restart injection;
- app relaunch/window replacement;
- event-loss injection;
- capture stream churn;
- permission status reads;
- no high-impact real actions.

Required:

- no leaked service/session/image/recording resources;
- no stale PiP target over two frames;
- no safety counter events;
- bounded memory/file growth;
- p95 does not degrade more than 20% from first hour.

## Output format

Machine-readable JSONL:

```json
{
  "schema": "bimax.cu.benchmark.v1",
  "traceId": "…",
  "mode": "native",
  "task": "fixture.background_set_value",
  "dimensions": {},
  "stagesMs": {},
  "result": {},
  "safety": {},
  "resources": {}
}
```

Human report:

- p50/p95/p99 by operation/app/profile;
- baseline/native delta;
- failure categories;
- safety counters;
- payload/model-turn reductions;
- regressions with trace IDs.

## Release gate

Bimax-Cu cannot become the default macOS backend until:

- all zero-tolerance safety counters are zero;
- targeted and full focused suites pass;
- fixture suite passes;
- background matrix is complete;
- 30-minute and 8-hour soaks pass;
- runtime budgets pass or have explicit app-specific exceptions;
- model completion is non-inferior;
- native/CUA shadow mismatches are resolved;
- rollback is verified.
