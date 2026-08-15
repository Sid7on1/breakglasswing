# Computer Use — Handoff Work Log

Running record of work done after inheriting the uncommitted perception/receipt overhaul.
Branch: `computer-use/perception-and-receipts` (off `main`, unpushed).
Started 2026-07-26.

Every entry records what was run, the actual result, and anything left unproven. Claims here are
only claims I verified myself in this session — inherited claims are marked as inherited.

---

## 1. Inheritance audit — re-verified the tree before touching it

No tracked file was modified during this step. Working tree on arrival: 15 modified files
(+2145/−139), 11 untracked (~1250 lines).

Gates re-run independently:

| Gate | Command | Result |
|---|---|---|
| Computer suites | `npx jest --testPathPatterns comput` | 17/17 suites, 263/263 tests (91 s) |
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx eslint 'src/**/*.ts' --quiet` | clean |
| Whitespace | `git diff --check` | clean |
| Targeting benchmark | `npm run benchmark:computer` | 10/10, p50 0.012 ms, p95 0.020 ms |
| Colour benchmark | `npm run benchmark:computer:color` | 6/6, p50 0.0089 ms, p95 0.011 ms |
| Receipt benchmark | `npm run benchmark:computer:receipts` | 6/6, p50 0.0014 ms, p95 0.0021 ms |

Confirmed landmarks exist where the handoff said: helper at `DESKTOP_HELPER_VERSION = 23`
(`src/computer/helper.source.ts:1254`), window reconciliation (`desktop.runtime.ts:2894`),
exact-window click refusal (`desktop.runtime.ts:2515`), `foveatedTriggered`
(`desktop.runtime.ts:2937`), `watchAccessibility` (`desktop.runtime.ts:1097`).

**Correction to the handoff:** it lists `src/computer/transport.ts` as modified. It is not —
`git diff -- src/computer/transport.ts` is empty. Transport is untouched by this overhaul.

**Not verified at this point:** the live TextEdit receipt workflow and the Swift helper compile.

## 2. Landed the overhaul on a branch

Rationale: ~3400 verified lines sat unlanded on `main` as a single blob with no branch and no
stash. That was the largest concrete risk in the tree, ahead of the driver upgrade.

Nine commits, dependency-ordered so each builds on what precedes it — three pure modules, then
helper v23, then the verification outcome the runtime consumes, then the runtime, then the tool
schema and persona:

```
3f0de4eb  chore(computer): live receipt verification script and benchmark entrypoints
6e6d6ffc  feat(persona): ground vague GUI requests in observe-then-act
9c4eaab4  feat(tools): expect/expectMode postconditions and a complete permission gate
93dbdacb  feat(computer): exact-window ownership, event-epoch frames, atomic semantic typing
4215a611  feat(computer): distinguish a missed postcondition from a pixel change
fb9ccd61  feat(computer): native helper v23 — AX event watch, foveated Vision, ROI contours
5dbc16ad  feat(computer): action receipts proving input reached the intended element
510d3193  feat(computer): normalized sRGB/OKLab fingerprints as supporting evidence only
42e6316e  feat(computer): semantic target ranking that abstains instead of guessing
```

Total `main..HEAD`: 26 files, +3395/−139. `git status` empty afterwards — nothing left behind, and
no file content was altered, only staged.

Re-verified at the branch tip: 17/17 suites, 263/263 tests, `tsc --noEmit` clean.

**Caveat:** the tip is gated, individual intermediate commits are not. History is not proven
bisectable.

**Noted during review:** `9c4eaab4` is not only a feature commit. `GATED_ACTIONS` in
`src/tools/implementations/computer.tool.ts:13` previously omitted `scroll`, `move`, `hover` and
`request_access`, so those verbs were reachable without the governor. That is a permission fix; it
got its own commit and is called out in the commit message rather than buried in the feature.

## 3. Live TextEdit receipt gate — reproduced

`npm run test:computer:receipt-live`, run against the real desktop. Read the script first: it
creates one untitled document, never closes pre-existing documents, and never quits TextEdit.

Result `ok: true`. Evidence actually returned:

| Claim | Observed |
|---|---|
| Foveated Vision triggered | `triggered: true`, 11 OCR text regions, 442 ms |
| Target | TextEdit pid 68299, **window 512**, `AXTextArea` "First Text View" |
| Preflight | `windowMatched: true`, `elementMatched: true`, confidence `high`, `stable: true`, `editable: true` |
| Delivery | `delivered: true`, recipient TextEdit |
| Value proof | `exactValueLengthDelta: 32` — exactly the marker length |
| Same element | `sameFocusedElement: true` |
| Confidence | `proven` |
| Cleanup | document closed directly, no save prompt, no file created |

Driver line in the same run: **running v0.12.3, v0.12.6 available** — confirms the pin is live and
not silently upgraded.

**Gap this run does NOT close:** `shapeRegions: 0`. The dual-polarity contour / rectangle / shape
path never fired, because a TextEdit text area is not an ambiguous unlabeled control. Shape
fingerprinting remains unit-tested only, not live-proven.

## 4. Cross-application perception probe

New script: `scripts/probe-computer-cross-app.ts` (typechecks, lints clean). Read-only for every app
except TextEdit, which is the only app it types into, and only in windows it created.

### Perception profile — 5 apps, one run

| App | scanned → visible | degraded | observe ms | dominant roles | foveated |
|---|---|---|---|---|---|
| TextEdit | 377 → 18 | yes | 1091 | `VisualText` ×18 | fired, 28 OCR regions, 466 ms |
| Notes | 175 → 175 | no | 2758 | `AXCell` 116, `AXRow` 58 | fired, 37 OCR regions, 569 ms |
| Calculator | 229 → 24 | no | 322 | `AXButton` 22 | fired, 13 OCR regions, 232 ms |
| Maps | 268 → 21 | no | 530 | `AXButton` 9, `AXStaticText` 6 | fired, 17 OCR regions, 435 ms |
| WhatsApp | 255 → 255 | yes | 669 | `AXMenuItem` 224, `AXMenu` 21 | **did not fire** |

Resolver probes (read-only) resolved every label tried in Calculator (Delete, All Clear, Percent)
and Maps (Apple Maps, Clear Recents, Terms & Conditions).

**The TextEdit row is not a valid measurement.** That observation captured a leftover *Save panel*,
not a document — see finding 4.3. It is left in the table because it is what the harness reported.

### 4.1 Multi-window, same process — the core claim HOLDS

Two TextEdit documents in pid 68299, windows 617 and 624, distinct windows confirmed. Acting on
window 617's handle while 624 was frontmost was **refused**:

> stale frame (superseded): frame f23-68299-617 has been superseded by f25-68299-624; the
> coordinates were planned from a picture that no longer describes the screen — observe again and
> re-pick the target

This is the case a pid-only check passes and the exact-window check catches. It works.

Recovery after the refusal did **not** complete, but for a legitimate reason: a real app-modal save
dialog was blocking the app (finding 4.3), and the runtime correctly refused to type behind it.

### 4.2 Shape/contour perception never fired — 0 for 5

`shapeRegions: 0` in every app, including Maps, which is full of unlabeled icon buttons. OCR fired
in 4 of 5; the dual-polarity contour / rectangle / shape-class path did not fire once. It remains
unit-tested only. Either the trigger is narrower than intended, or none of these apps presented the
ambiguous-unlabeled-control shape the trigger requires. **Unresolved — needs a deliberate test.**

WhatsApp is the sharper version of the same gap: it produced the *worst* tree of the five — 255
elements that are **100% menu bar** (`AXMenuItem`/`AXMenu`/`AXMenuBarItem`), zero window content,
no `frameId` — and the ambiguity trigger did **not** fire. That is precisely the "thin/degraded tree"
case Vision exists for. See also the pre-existing note that driver 0.12 walks menus before windows.

### 4.3 BUG — the live receipt script reports a clean discard that did not happen

`scripts/verify-computer-receipt-live.ts` prints
`"discard": {"prompt": "not shown; TextEdit closed the untitled document directly"}` and exits.
It checks for the discard button ~150 ms after `cmd+w`. The macOS "keep this new document?" sheet
animates in **after** that check, so the script declares a clean close and disposes, leaving an
app-modal save dialog on the user's desktop holding a document full of its own marker text.

Proven, not inferred: the leftover document read back as exactly `BIMAX-LIVE-RECEIPT-1785046159832`,
the marker from the 06:09 run, and a screenshot shows the sheet
*"Do you want to keep this new document 'Untitled 2'?"*.

The earlier claim in section 3 of this log — "document closed directly, no save prompt" — is
therefore **wrong**. No file was written to disk, but the app was left blocked.

### 4.4 RETRACTED — the harness was right, my cleanup script was wrong

**First written as a bug, then disproved. Recorded in full because the retraction is the finding.**

The claim was: with the modal sheet up, `cmd+w` was sent five times, each returned success, and
nothing closed — therefore keyboard verbs escape the modal guard and report false success.

The first half is true: nothing closed, and my loop logged `closed-empty` five times. The
conclusion was wrong. My cleanup script called `runtime.run(...)` for the keystroke and **never
looked at the result at all** — it inferred success from its own re-observation logic.

Checked properly with a mocked no-effect `cmd+w` on the foreground key path, the runtime returns:

```
progressCheck: { outcome: 'no-change', frameChanged: false,
                 note: 'the screen is pixel-identical to before the action — it had no visible effect' }
actionResult:  { delivered: true, observed: 'no-change', confidence: 'unknown' }
summary:       '...screen did NOT change: the input landed but nothing visibly happened;
                re-observe and adjust rather than assuming it worked'
recoveryDecision: 'recover'
```

So the "meaningless action reduction" claim **does** hold for keyboard verbs. `delivered: true` is
accurate and is explicitly separated from `observed: 'no-change'` and `confidence: 'unknown'`.
Bounded recovery even escalated to `recover` after a single no-effect press.

Lesson for anyone driving this runtime directly: `ok: true` means the command executed, not that it
worked. `actionResult.confidence` and `progressCheck.outcome` are the success signals. A regression
test for this contract on the key path was added (the existing one covered clicks only).

### 4.5 Unresolved — clicking a control inside a sheet was refused

Clicking the sheet's own Cancel button was refused:

> element preflight refused the click: expected AXButton "Cancel", but the live point resolves to
> AXTextArea "?" (best native recipient matched only label contradicted (score -45))

Either the sheet was observed mid-animation and this is preflight working exactly as designed, or
sheet-hosted element frames do not map into the same space as window elements. Not yet determined.
Worth resolving, because clicking a save/confirm sheet is an extremely common interaction.

## 5. Fixes landed

Three commits on top of the nine inherited ones:

| Commit | What |
|---|---|
| `27a65743` | `test(computer)`: pins delivered-vs-observed on the key path — the click path had this test, the key path did not |
| `852d056c` | `fix(scripts)`: the live receipt check now polls for the save sheet, re-observes before clicking, proves the sheet is gone, and falls back to Escape reporting `manualCleanupRequired` rather than claiming success |
| `4cfe37e1` | `feat(scripts)`: the cross-app probe and this log |

Gates after the fixes: **17/17 suites, 264/264 tests** (263 inherited + 1 new), `tsc --noEmit`
clean, `eslint --quiet` clean.

## 6. Open items, in the order I would take them

**These are universal invariants, not per-application work.** The goal is universal computer use;
no app gets a special case, a workflow, or a name in the code. Applications appear below only as
the instruments that exposed a broken property, and are interchangeable with any other app that
exposes the same one. If a fix here needs to know which app it is talking to, the fix is wrong.

1. **An observation containing no window content is returned as a successful observation.** Menu-bar
   elements only, no window content, no `frameId` — handed back as a valid frame instead of being
   treated as a failed window acquisition. Instrument: WhatsApp (4.2).

   Originally filed as "the ambiguity path does not trigger". Reading the code corrects that:
   `canSampleVisuals` requires `observedWindowFrame` and screenshot dimensions
   (`desktop.runtime.ts:2941`), so with no captured window there are no pixels and Vision *cannot*
   run. No trigger change fixes it. The defect is upstream, in window acquisition — the existing
   zero-pixel / window-reacquisition recovery should have fired and did not. Property to fix: an
   observation with no window content is a failed acquisition, never a usable frame.

2. **DOWNGRADED — `shapeRegions: 0` across five apps was correct behaviour, not a gap.** Shape
   regions are built from `unnamedActionables`: elements with an actionable role AND an empty or
   `unlabeled` label (`desktop.runtime.ts:2996`). Every window probed had fully labeled controls, so
   the shape list was legitimately empty and only the OCR region ran. My original reading — "the
   trigger is narrower than intended or the shape pass is not reached" — was wrong.

   What is still true: the shape path has never executed with real input. That wants a unit-level
   proof driving genuinely unlabeled actionable controls, not another live hunt.
3. **A control hosted in a sheet may not hit-test to itself** (4.5). Either preflight correctly
   caught a mid-animation sheet, or sheet-hosted element frames map into a different space than
   window elements. Property to settle: an element's reported frame hit-tests to that element,
   regardless of what kind of container hosts it.
4. **Driver 0.12.6 — dropped, not wanted.** Decided 2026-07-26: stay on 0.12.3. The upgrade buys
   nothing the current work needs and would add sidecar variance for free. The staged-candidate
   procedure in the original handoff stays on the shelf until there is a concrete reason to run it.
5. The nine inherited commits are gated at the tip only, not individually. If bisectable history
   matters, that needs a pass.

## 7. Standing note on live verification

Anything that drives the real desktop must leave it clean, and must be able to *prove* it left it
clean. Two of the four issues in this session came from a cleanup step that reported success it had
not verified. The receipt architecture applies to the test scripts too, not just the runtime.

## 8. Item 1 fixed — window acquisition (`27e17cfd`)

Root cause, from reading the code rather than probing further: `windowElementsOf` strips menu roles,
so a walk that returns only menu nodes leaves `windowElements` empty. That set `degraded = true` and
the observation then **fell back to the raw element list** — which, by construction, is exactly the
menu nodes that were just excluded. Their frames lie outside the window entirely.

The sharper half: those elements were registered in `indexedElements` (addressable by
token/index, so a model could target one) while `observedElements` deliberately excluded them, so
the semantic resolver refused to reason about the very targets the observation was offering. And
with no window frame, `mintFrame` returned null — no `frameId` — so nothing downstream could even
refuse a stale coordinate.

Two changes, both universal, neither aware of any application:

1. **Acquisition.** No window element after the ceiling rescan → re-derive the app's current top
   window once and observe that instead. Only the window component changes; pid/app ownership is
   untouched, the same move the Cmd+N and zero-pixel recoveries already make. Bounded to one
   attempt, so a genuinely AX-silent window still returns a screenshot-only observation.
2. **Honesty.** A window-scoped observation with no window content returns **no targets** and leans
   on the screenshot — which is what its own degraded guidance already tells the model to do.

Both tests were run against the unfixed runtime and fail there. The first version of the
acquisition test passed without the fix — `open` performs its own capture and had already landed on
the good window — so the fixture was rebuilt to replace the window *after* acquisition. A test that
passes against the unfixed code pins nothing.

Gates: **17/17 suites, 266/266 tests**, `tsc --noEmit` clean, `eslint --quiet` clean.

**Remaining:** item 2 (shape path needs a unit-level proof with unlabeled controls) and item 3
(sheet-hosted controls hit-testing). Item 4 is dropped.

## 9. Items 2 and 3 closed (`a448da1d`) — neither was a defect

**Item 3, sheet hit-testing — answered, no fix needed.** The hypothesis was that sheet-hosted
element frames map through a different space than window elements. False, and provably so from the
code: there is exactly one transform, `globalFrameToScreenshot` / `screenshotToGlobal`, keyed on the
window frame, and it knows nothing about what kind of container an element lives in. A sheet's
control carries a global screen rect like every other element and round-trips like every other
element. A round-trip test now pins that, including the case where the sheet has moved between
observation and click — which does not round-trip, and is exactly the divergence preflight refuses
on. So the live refusal was the guard working, not a coordinate bug.

**Item 2, shape foveation — behaviour was correct, coverage was missing.** Shape regions are
foveated into actionable controls carrying no label. Every window probed live had fully labeled
controls, so the empty shape list was right. The path is now exercised by a test that supplies
unlabeled actionable controls directly, rather than by hunting for an application that ships them —
which would have been per-app testing by the back door.

Gates: **18/18 suites, 276/276 tests**, `tsc --noEmit` clean, `eslint --quiet` clean.

## 10. Where this ended

Branch `computer-use/perception-and-receipts`, 19 commits, unmerged and unpushed.

Fixed this session:

* Window acquisition — an observation with no window content is now a failed acquisition that
  re-derives the window, and never offers menu-bar nodes as window targets (`27e17cfd`).
* The live receipt script no longer reports a discard it did not perform (`852d056c`).

Answered, no change needed: sheet hit-testing, shape foveation, and the keyboard delivery contract —
all three looked like defects and none were. Two of them were my own measurement error.

Still genuinely open:

* The nine inherited commits are gated at the tip only. History is not proven bisectable.
* Driver 0.12.6 dropped by decision, not by evidence. If it is ever wanted, the staged-candidate
  procedure in the original handoff still applies.
* Cross-app coverage is five applications on one machine, one run. It is enough to have found real
  bugs; it is not a broad guarantee.

The honest summary: the architecture held up under every check it was put through. Most of what
looked broken was either the test harness around it or the person reading the output.

---

## 11. MCP surface audit and repairs (2026-07-30)

New surface since section 10: `src/mcp/computer.server.ts` exposes the runtime over MCP stdio as
`bimax-computer`, registered in the gitignored `.mcp.json` and launched by `scripts/mcp-computer.sh`.
This session audited that surface from the outside — as a client, not as a caller of the runtime —
and then repaired what the audit found.

### 11.1 Registration

`.mcp.json` is project-scoped, and project servers need a per-project approval recorded in
`~/.claude.json` under `projects[...].enabledMcpjsonServers`. That array was empty, so the CLI
reported `⏸ Pending approval` while the desktop app loaded the server anyway (the project has
`hasTrustDialogAccepted: true`). Two surfaces, opposite answers, same server. Approval added.

`october-bus` in the same file is permanently failing on an unexpanded `${OCTOBER_BUS_PORT}`.
Untouched — not this session's scope.

### 11.2 Method

All 32 public actions exercised over real stdio against the real desktop (TextEdit as the
instrument), 56+ timed calls. **Ground truth was taken outside the runtime** — AppleScript for
document text, `pbpaste` for the clipboard, `ps` start times for launches — because the runtime's
own summary was the thing under test. Harnesses are in the session scratchpad, not committed;
they are ~60 lines of stdio JSON-RPC each and are faster to rewrite than to maintain.

Baseline latency, 56 calls: mean 828 ms, median by action — `open` 2040 ms, `click` ~1700 ms,
`observe` 667 ms, native-helper reads (`frontmost`/`cursor`/`clipboard`) 11–29 ms. Nothing was
pathologically slow. The ~1.5 s post-action evidence capture on every acting verb is the dominant
cost and is the right trade; it is what makes `observed`/`postcondition` real.

### 11.3 What was wrong, and what was done

| # | Defect | Fix |
|---|---|---|
| A | A retired session wedged the runtime for the process lifetime | `transport.ts` revives in place and retries once |
| B | `status` reported `ready` while every stateful call was rejected | real session-scoped probe, or says it did not probe |
| C | `click query="First Text View"` resolved to `AXButton "font size"` at `confidence: medium` | three scorer fixes |
| D | `open` returned `ok:false` while the app launched | launch reported `delivered:true, observed:"unverified"` |
| E | `record_start` unreachable from MCP; `record_stop` claimed success with nothing running | honest messages; `record_stop` fails when nothing ran |
| F | `arrange` refused itself ~1 ms after the `open` that created its window | window-scoped verbs exempt from the AX-epoch refusal |
| G | `frameId` described a guard stronger than the one that exists | description corrected |
| — | `seconds` in the schema was read by nothing; `ms` was unreachable | schema corrected |
| — | `apps` 22.6 KB, `windows` ~50 entries, both unfiltered | projected and filterable |
| — | `observe` and `screenshot` were the same call under two names | split by payload |

**A — the run-ender.** The driver retires a session on its own and then rejects every session-scoped
call. That arrives as an app-level `isError` *result*, not a rejected promise, so it never reached
the branch in `TransportClient.call` that condemns a dead connection — and the connection was in
fact healthy, so condemning it would have been wrong anyway. Nothing re-issued `start_session`, so
the runtime reused a client whose session was gone until the process died. It now applies the repair
the driver's own message names: re-issue `start_session` on the same connection, retry once, and
condemn only if the revive itself fails. Observed live before the fix; unit-tested after.

**B.** `health_report` is not session-scoped, which is exactly why it could report
`session_active: pass` during the wedge. `status` now issues a real session-scoped call when a
target exists and reports `(session liveness unprobed)` when there is nothing to probe against.
A rejected probe forces `overall: degraded`, `ok: false`.

**C — the one that silently corrupts work.** Three defects in `semantic.targeting.ts`, all
reproduced offline from the live element list per section 5's standing method:

1. `textScore` treated containment as symmetric: `q.includes(v)` returned 84 for *any* value that
   was a substring of the query, so on a degraded frame the single glyphs `"I"`, `"S"`, `"V"` each
   scored 80+ against `"First Text View"` and tied the real target at margin 0. Containment is now
   asymmetric — a label containing the query stays strong, a label that is a fragment of it scores
   in proportion to how much of the query's *content* it covers.
2. `ordinalFrom` read the word `"first"` out of macOS's own control name. AXTextArea's standard
   label **is** `"First Text View"`, so the query parsed as "the 1st match", every real candidate
   took the −8 penalty, and +35 went to whatever sorted first in space. Now suppressed when a
   candidate carries the ordinal word inside its own name — the discipline defect 2 in section 5
   applied to bare numbers, one level up.
3. A winner that matched no content word of a naming query could still be reported `medium`. It is
   now capped at `low`, so nothing is acted on that won purely on a role or position bonus.

   Before: `label "font size"`, `AXButton`, `medium`, margin 52, `["context matched","position matched"]`
   After:  `label "First Text View"`, `AXTextArea`, `high`, margin 116, `["label matched"]`

   The closed loop this created is worth recording: `type` with no target refused as ambiguous and
   named `"First Text View"` as the field to pick; naming it resolved to `"font size"`; `type` then
   refused *because* the target was a button. The tool's own remediation could not be followed.

**Coverage caution:** the scorer changes are app-agnostic by construction and the suite caught one
regression they would otherwise have shipped (`"blue Send button"` → label `"Send"`, where the role
word inflated the coverage denominator — coverage now measures stop-word-stripped content). But live
confirmation is **TextEdit only**. A thin AX tree (WhatsApp, per the earlier probe) is where I would
look next.

**F.** `arrange` is addressed by window identity, not by the element map, but sat in
`FRAME_GATED_VERBS` and so was refused by a guard about coordinates going stale. `open` mints
`AXWindowCreated` for the very window `arrange` was told to lay out. New `WINDOW_SCOPED_FRAME_VERBS`
keeps the observe-before-act requirement and drops only the AX-epoch refusal. Same family as the
semantic re-grounding that already exists because opening Messages refused its own next step.

**Payloads.** `apps` dropped the per-app `windows` array the driver never fills (measured empty for
*running* apps), projects usable fields, sorts running first, strips the bidi mark from names, and
accepts `query`: 22,660 B → 8,093 B, or 323 B filtered. `windows` hides untitled degenerate surfaces
and the driver's own capture overlay — which enumerates above the app it is driving — while keeping
every titled window including off-screen ones on another Space. `screenshot` now returns the picture,
`frameId` and `elementCount` without echoing the element arrays: 21,380 B → 3,810 B. The element map
is cached on the runtime, so `click query=…` after a screenshot-only still resolves at `high`/116.

### 11.4 Reversed on review

I flagged `arrange` returning `ok: true` when an app clamps its geometry as a defect. It is not.
`bimax.computer.runtime.test.ts` already pins `ok: true` with `postcondition.matched: false` and a
comment explaining that claiming a clean tile would be a lie — a deliberate decision I had objected
to while ignoring the two honest fields beside it. The window does move, so it is not a delivery
failure. What was actually missing was the only thing a caller can act on: the summary now says
retrying the same layout will produce the same geometry, and to plan against `windowFrame`.

### 11.5 Gates

`npx tsc --noEmit` clean. **1908/1910 tests pass** across 201 suites (2 skipped, 1 suite skipped).
11 new tests: session revival, degraded status, unprobed status, delivered-launch, window
suppression, app projection and filtering, `record_stop` honesty, the screenshot/observe split, and
four in `computer.semantic.targeting.test.ts` covering the ordinal-in-a-name case, the
one-character containment case, the legitimate containment direction, and the unmatched-name refusal.

### 11.6 Left open

* **The session-retirement trigger is unknown.** The revive makes it recoverable rather than fatal,
  which is why I stopped chasing it. An idle probe survived 2 and 3 minutes; the 5-minute sample was
  invalid because my own cleanup had closed the target window. Do not record a threshold — there
  isn't one yet.
* **D is unit-tested only.** Reproducing the original false negative needs a wedged session, and
  fix A now prevents exactly that.
* **Scorer breadth**, as above: one application, one machine, one run.
* **`observe`/`screenshot` still do the same work**; only the payload differs. Merging them properly
  means touching the frame model, which both verbs mint into.
* Nothing here is committed. These changes sit alongside the uncommitted work already in the tree.

---

## 12. Bimax-Cu phases 3–8 live in the porting ledger

Everything after section 11 is recorded per slice in `docs/BIMAX_CU_PORTING_LEDGER.md`, not here.
That file is the evidence record: each entry names the upstream source, the deliberate divergences,
the offline suite result, and the live conformance result separately.

As of 2026-08-01, Phases 7 and 8 are closed. Phase 8 delivered governed app/file/window operations,
usable display bounds, the measured Spaces refusal, live-verified `AXShowMenu`, bounded parallel AX
reads, safe label corrections, task-owned product-feature policy, exact-bundle guidance, doctor and
permission UI, and a read-only-by-default external MCP boundary.

The old capture/focus blockers are obsolete. ScreenCaptureKit delivered four complete 1120×976
fixture frames, and all five delivery policies passed the desktop-broker focus harness, including
exact prior-PID restoration. The final real-app/background matrix sampled 12 running AX servers;
four returned non-empty complete trees, and the foreground stayed unchanged. Native foundation is
60/60, native/MCP TypeScript is 86/86, and the product PiP/recording/trajectory/replay group is
214/214.

Phase 9 has started with an additive semantic opt-in. Setting
`BIMAX_CU_NATIVE_SEMANTIC_ROUTING_ENABLED=1` may register only the signed, verified
workspace/AX/action/transaction/capture tools. The compatibility `ComputerTool` remains registered
for global pointer/key work and rollback. Full `assessNativeCutover` remains stricter and still
refuses until native physical input is implemented and proven.

Phase 9 slice 2 adds opt-in read-only shadow comparison behind
`BIMAX_CU_NATIVE_SHADOW_ENABLED=1`. It runs after compatibility observations and never blocks or
changes their results. It resolves native window generations read-only, falls back visibly to
application scope, sheds overlap/capacity, and keeps only 64 content-free count/digest receipts.
The shadow tests pass 4/4 and the integration set passes 54/54. The current staged binary is
development-signed (`serviceSigned: false`), so live cohort collection remains correctly disabled
until a signed package is available.

### 12.1 Phase 8 slices 5–8 verification

The native foundation is **60/60** through `scripts/test-bimax-cu-native.sh`; the twelve native/MCP
TypeScript suites are **86/86**; root and app TypeScript pass; scoped ESLint exits zero with warnings
only. Direct `swift run` without the repository script still selects the machine's mismatched
SDK/cache path and fails before compiling the package, so do not quote that invocation as a product
failure or a passing result.

The capability boundary still matters: the current service reports cursor overlay, trajectory,
video, replay, and global physical input as unavailable. Those product behaviors remain on the
compatibility surface during migration. `show_menu`, capture, and focus lease are now live-verified;
the semantic Phase 9 gate cannot turn missing physical input into a full-cutover claim.

---

## 13. Phase 9 release-candidate completion and cross-phase bug hunt

Date: 2026-08-02

Phase 9 is complete at the repository implementation boundary in Bimax 1.1.0. macOS uses signed
semantic native routing by default only after the discovery service and live bridge independently
pass every structural gate. Deterministic 5/25/50/100% cohorts, explicit shadow-evidence approval,
bounded content-free health samples, persisted automatic rollback, and `/computer backend` operator
controls are wired through the container, native tool execution, CLI, and Electron status UI.

The rollback rule is intentionally asymmetric: future work can return to `ComputerTool`, but a
failed native action is never replayed because delivery may already have crossed XPC. Correlation,
malformed-response, protocol, and ambiguous-timeout faults trip immediately. Availability faults
trip on the rolling budget; approval, validation, stale-target, and app refusals are neutral.

Packaging now compiles the first-party helper for arm64/x86_64 at build time and passes its fixed
path to the engine. Runtime `swiftc` is gone. Default macOS CLI artifacts omit the CUA binary while
retaining `ComputerTool` through the first-party helper; Linux keeps CUA, and
`BIMAX_PACKAGE_CUA_COMPAT=1` remains the emergency macOS build for the fallback release.

The cross-phase audit found and fixed three release blockers:

1. Electron hard-coded `identity: null`, so even credentialed release CI could never sign the app,
   bridge, or XPC service and native routing could never satisfy `serviceSigned`.
2. The native bundle advertised 0.6.0 while `ServiceCore` returned 0.7.0.
3. The native transaction canonicalizer violated the only error-level ESLint rule.

The local candidate passes root/app TypeScript, app production bundling, protocol-mirror integrity,
Go TUI integration after the normal build, arm64/x86_64 helper compilation, the Swift foundation
60/60, and the full Jest suite. The release operator must still supply Developer-ID/notarization
credentials, collect signed shadow/ramp evidence, run the 8-hour soak, and satisfy the two-release
elapsed gate; `docs/BIMAX_CU_CUTOVER_RUNBOOK.md` is the authority for those steps.

---

## 14. Close-out — naming a target now works, and this is where computer use stops

Date: 2026-08-04. **This section closes the computer-use effort.** Everything below was verified on
this machine in this session against real applications, not against fixtures.

### 14.1 The defect that mattered, and it was one line

Naming a thing and clicking it is the whole product surface, and it did not work on any list. The
symptom was reported as "the clicks are inaccurate". It was not a click problem at all — targeting
never got a name to aim at.

The runtime forwarded the caller's `query` to the driver's `get_window_state`. Measured at caps 180
and 600 in Notes, that parameter returns the **identical `element_index` set** — it widens nothing —
but it replaces `tree_markdown` with just the matched node's ancestry: **367 lines became 8**. The
tree is the only place `AXStaticText` leaves appear, and folding those leaves onto their container
is what gives an anonymous list row its name. So forwarding the query deleted the name of every row
*except* the one being searched for.

The damage landed where it was least visible. `postActionEvidence` re-observes using the active
expectation as its query, so **the frame handed back after any action carrying `expect` came back as
46 indistinguishable `ICMNoteListCell`s**. The next click by name then resolved to the row's OCR twin
or refused as ambiguous. An observe looked fine; the frame you were meant to act on did not.

Not forwarding it costs nothing: `verification`, the match ordering and the semantic resolver all
run locally over the elements the walk already returns.

### 14.2 A fix from the previous session that was chasing a phantom

A retry at a deliberately NARROWER cap had been added on the theory that a wider element walk
truncates the tree and deletes the names it was widening to find. **That theory was wrong.** Tree
coverage grows monotonically with the cap — named rows in Notes went 9 (cap 80), 16 (120), 25 (180),
35 (260), 52 (400), 77 (600), 127 (1000), never a collapse. The collapse being chased was entirely
the forwarded query. The retry is deleted: it bought strictly less evidence for an extra round trip.

Recorded because the mistake is instructive — the earlier session wrote a confident measured-sounding
comment ("at cap 120 the tree named every note row") that a five-minute sweep contradicts. A single
observation at two caps is not a curve.

### 14.3 Live evidence, cold machine, real apps

Notes, cold (not running), through the MCP surface the way a client actually drives it:

| Property | Result |
|---|---|
| Rows named by the tree | every row: "Flexon MR", "Potatoes 1kg", "Google Maps", … (was 46× `ICMNoteListCell`) |
| Click by name | `high`, margin 104, `elementIndex 9`, `label matched` |
| Delivery receipt | `recipientApp: Notes`, `windowMatched: true`, "recipient matched by role + label + frame" |
| Post-action frame | 16 named rows retained — the next click by name still resolves |
| Notes created by a cold open | **0** — window title held `Notes – 193 notes` across repeated cold launches |

That last row is the regression that used to move the user's library 193 → 195, one empty note per
`open`, in a session that never asked for a note.

**Speed**, measured end to end in a fresh process, screenshots on:

| Step | Time |
|---|---|
| `open` (cold launch, includes the 2s windowless grace) | ~4.1 s |
| `observe` with a query | ~1.1 s |
| `click` by name + fresh post-action frame | ~1.0 s |

The driver walk is ~3.7 ms/node and dominates: cap 120 → 83 ms, 180 → 427 ms, 600 → 2.1 s. The
default 120 floor is the reason a plain observe is ~1s rather than ~3s.

### 14.4 One real limit, now stated instead of hit

Background delivery activates an element through its published AX action, and **plenty of ordinary
controls publish none**. A Notes row advertises `actions=[showmenu]` and nothing else, so `AXPress`
returns −25206 and the row cannot be activated that way at all — while a foreground click opens it
in ~1.0 s.

The driver's raw string named an AX constant and offered no next step, so the model reissued the
identical call. It now refuses with the cause, the fact that it is a property of the control rather
than a transient failure, and the delivery that does work. Deliberately a refusal and **not** an
automatic downgrade to a physical click: foreground moves the real cursor and takes focus, which is
exactly what the caller asked to avoid, and swapping it silently is the same dishonesty the
off-Space guard already refuses.

### 14.5 Gates

`npx tsc --noEmit` clean. Computer suites **201/201 across 4 suites**, including two new regression
tests: the driver query must never be forwarded (asserted over every `get_window_state` call, with
both rows keeping their names), and the no-AX-press refusal must name a permanent cause and the
working delivery mode. Full Jest suite green.

### 14.6 What is deliberately NOT claimed

* **Live confirmation is Notes and TextEdit.** The changes are app-agnostic by construction — nothing
  keys on a bundle id — but a thin-tree Catalyst app (WhatsApp, 31 elements) is the untested shape.
* **The `-25206` set is not enumerated.** It is known that Notes rows lack `AXPress`; which other
  roles do is unmeasured. The refusal is correct whenever it fires, but it fires on discovery.
* **The scan cap curve is one machine, one driver version (0.12.3), one app.** 0.17.0 is available
  and unevaluated; the ~3.7 ms/node constant should be re-measured before it is trusted again.
* Nothing above changes the native/signed cutover position in section 13, which is unchanged.

---

## 15. Reopening 14.6 — the close-out's own three unknowns, and what live WhatsApp actually showed

Date: 2026-08-05. Section 14 closed the effort with three items "deliberately NOT claimed". Taking
them seriously found three defects, two of them introduced by the close-out commit itself. The
headline: **WhatsApp is not a thin-tree app, and the runtime was telling the model that it was.**

### 15.1 The thin-tree notice counted the wrong thing, on every app

`thinTreeNotice` and `windowPreparationNotice` measured namelessness as an empty `original_label`.
That field does not mean "the app supplied no name" — it means "the name this control had BEFORE the
runtime rewrote it", so it exists *only* on controls a rewrite touched. The predicate was inverted.

Measured live on WhatsApp: 31 actionable controls, of which exactly 2 had been rewritten by
`enrichControlLabels` ("More — Chats", "More — Search"). The notice therefore announced

> This app exposes little accessibility text: **29 of 31** controls have no name of their own …
> Do not keep re-querying for a control by a name you expect — it is not in the map.

in the same payload whose element map held `Heman`, `Dad`, `Mom 2`, `Park+`, `Shiprocket`, `Send` and
`Compose message` — every one of them addressable by name. The advice is the exact inverse of the
truth, and it pushes the model off names and onto raw pixels, which is the one thing
`bimax-semantic-scorer-defects` says is never a fallback.

Namelessness is now asked as a question about the caller, not about our own bookkeeping
(`hasSayableName`): a name is real if the app published it *or* the tree folded it out of the
control's own visible text, and it is not real when the only "name" is a positional placeholder this
runtime invented. `describeUnlabeledControls` now marks those with `label_source: 'synthesized'`
instead of leaving them indistinguishable from real names.

**This was a regression the close-out shipped.** Tree-text folding (14.1) is what made rows nameable;
the notice kept scoring the pre-fold world, so the better naming was invisible to it.

### 15.2 The tree parser silently ignored an entire tree dialect

A control's name appears in the tree in one of two forms. Notes writes it quoted
(`AXCell "ICMNoteListCell"`); WhatsApp writes it **in parentheses**, after the value when there is one:

```
- [17] AXButton = "message, Nuvu suil cheku vadii, 4:45 PM" (Heman, 1 unread message) [actions=[…]]
```

Only the quoted form was recognised, and the value regex required the closing quote to be followed by
`[` or end-of-line — so a parenthesised name broke the value match too. Parsed against the real
WhatsApp tree, **every node lost both its label and its value and the text map came back empty**:
`foldTreeTextIntoElements` was a complete no-op on that dialect. It went unnoticed only because
WhatsApp's `elements` happen to carry labels already, so nothing downstream needed the fold.

Both forms now parse, and the Notes fixture is unchanged as the regression witness.

### 15.3 The −25206 set is answered by evidence, not enumerated by role

14.6 wanted the no-`AXPress` set enumerated. Enumerating roles would have been the wrong answer —
it is per-app by construction, and `bimax-universal-not-per-app` rules that out. The tree already
carries the real answer per control:

| App | Row | Published actions |
|---|---|---|
| Notes | note row | `[showmenu]` — no press, this is where −25206 came from |
| WhatsApp | chat row | `[press, scrolltovisible, cancel, showmenu, unread, pin, …]` — pressable |

`actions=[…]` is now parsed (counting brackets, so the multi-line custom entries cannot end the list
early) and folded onto each element as `ax_actions`. A background click on a control whose published
list omits `press` is refused **before the attempt**, with the same message the reactive path uses.
So the refusal no longer "fires on discovery" — the answer was already in the observation the caller
planned from.

Silence is not a "no": an absent list means the tree said nothing, and the attempt still proceeds
with the reactive −25206 catch behind it. Only an explicit list without `press` is evidence.

### 15.4 A keystroke was refused for a stale element map it never reads

Opening WhatsApp raised its own "New chat" popover. The runtime's own guidance says to dismiss a
popover with escape. Escape was then **refused** — `AXFocusedUIElementChanged`, the app's own opening
event. The guard and the advice contradicted each other.

`key` carries no coordinate and no element handle, and the key path never consults the element map;
it hands the combo to the focused app. The guard's own sentence is "the visible element map may no
longer own those coordinates", and there are none. `arrange` was already exempt for exactly this
reason, so the set is now `IDENTITY_SCOPED_FRAME_VERBS` — addressed by an identity (window, or focus)
that an accessibility event cannot invalidate.

`type` and `paste` are deliberately **not** exempt: they are aimed by focus too, but a focus change is
precisely what puts their content in the wrong field, so they keep the guard and recover through
re-grounding.

### 15.5 Gates

`npx tsc --noEmit` clean; `eslint` 0 errors. Computer suites **506/506 across 35 suites**, including
four new regression tests written against the unfixed code first and observed to fail:

* an app-named control is not counted nameless merely because nothing rewrote it, while a genuinely
  blank app still gets the notice;
* the parenthesised name form parses, with the Notes quoted form unchanged;
* a background click is refused before the attempt when the tree published no `press`, and is *not*
  pre-refused when the tree was silent or did publish one;
* a combo-only `key` is delivered after an AX event instead of refused.

### 15.6 What is still open, and honestly so

* **The live re-run did not happen.** The Mac was locked (`loginwindow` frontmost) when the new code
  was ready, and the runtime correctly refuses to verify what it cannot see. Everything in 15.1–15.4
  was *found* live and is *fixed and covered offline*; re-running
  `npx tsx scripts/verify-name-coverage-live.ts WhatsApp Notes` on an unlocked machine is what turns
  the name-coverage and −25206 tables into measured live numbers rather than parsed ones.
* **The scan-cap curve is still one machine, one app.** The script measures it per app, but the run
  above never got past `open`. Do not quote ~3.7 ms/node until it does.
* **Driver 0.17.0 is available and still unevaluated** (0.12.3 is pinned; the daemon prints the
  upgrade notice on every run). Deliberately not taken in this session: it changes the surface every
  measurement here rests on, and it cannot be validated live on a locked machine. It remains the one
  genuinely open item, and it is a discrete piece of work, not a loose end in this code.

---

## 16. The live re-run, with before/after numbers

Date: 2026-08-05, later the same day, once the Mac was unlocked. Everything below is measured on real
applications through `scripts/verify-name-coverage-live.ts` (read-only: it opens and observes, never
clicks or types). BEFORE and AFTER are computed **from the same live payload**, so the comparison is
not two runs of a moving target.

### 16.1 Name coverage — the defect was worse than section 15 estimated

| App | BEFORE nameable | AFTER nameable | "Stop using names" notice |
|---|---|---|---|
| WhatsApp | **0 / 24** | **23 / 24** | fired BEFORE → silent AFTER |
| TextEdit (Open dialog) | **0 / 9** | 3 / 9 | fires in both — correctly, see below |
| Notes | 0 / 0 actionable | 0 / 0 actionable | never fired either way |

The old predicate reported **zero nameable controls on every app measured**, not "29 of 31" as the
first WhatsApp sample suggested. `original_label` is populated only on a control some rewrite
touched, so on any window where no rewrite fired it scored *everything* nameless. The sample names it
was hiding are ordinary words: `Chats`, `Calls`, `Updates`, `Archived`, `Starred`.

**Notes never triggered it**, which is why this survived the close-out: Notes' list is `AXRow`/`AXCell`,
neither of which is in `ACTIONABLE_AX_ROLES`, so the notice had nothing to count. The bug was only
ever visible on button-shaped apps — exactly the ones nobody re-measured.

**TextEdit still fires the notice, and should.** That window was a file-open dialog whose toolbar
buttons genuinely publish no name (6 nameless `AXButton`s). The fix did not disable the notice; it
made it answer the right question. Proof it still works is as important as proof it stopped lying.

### 16.2 The −25206 set, enumerated live instead of discovered

`background_activatable: false` is now on the wire for any control the tree says cannot take a press,
so a caller chooses foreground BEFORE spending a turn on a refusal.

| App | Cannot take a background press | Shape |
|---|---|---|
| Notes | **214 / 214** | `AXRow` ×71, `AXCell` ×142 — the entire list |
| TextEdit | 69 / 175 | `AXRow` ×37, `AXCell` ×27, `AXTextField` ×3, `AXOutline` ×1 |
| WhatsApp | **0 / 31** | every chat row accepts a background press |

This is the answer 14.6 wanted, and it is better than the role list it asked for. The set is not a
property of a role — `AXCell` is unpressable in Notes and pressable elsewhere — so any enumeration by
role would have been wrong on the next app. Reading what each control publishes is universal.

It also explains the original complaint precisely: background delivery **cannot** drive the Notes
list at all, and there was no way to know that without trying.

### 16.3 Scan-cap curve, re-measured across three apps (screenshots ON, end to end)

| cap | Notes | TextEdit | WhatsApp |
|---|---|---|---|
| 80 | 40 el / 17 rows / 628 ms | 80 el / 29 rows / 827 ms | 31 el / 671 ms |
| 120 | 40 el / 17 rows / 640 ms | 120 el / 29 rows / 802 ms | 31 el / 636 ms |
| 180 | 60 el / 25 rows / 1009 ms | 175 el / 36 rows / 854 ms | 31 el / 679 ms |
| 260 | 88 el / 36 rows / 1373 ms | 91 el / 45 rows / 732 ms | 31 el / 727 ms |
| 400 | 139 el / 53 rows / 1999 ms | 120 el / 61 rows / 819 ms | 31 el / 706 ms |
| 600 | 214 el / 78 rows / 2745 ms | 160 el / 81 rows / 1631 ms | 31 el / 709 ms |

Three things this settles:

* **Named rows grow monotonically with the cap** — Notes 17 → 78, TextEdit 29 → 81. Section 14.2's
  claim now holds on a second and third app, and the deleted narrower-cap retry stays deleted.
* **The cost is not universal.** WhatsApp is FLAT at ~0.7 s across every cap because its window
  publishes 31 elements no matter what is asked for. Paying for a wide walk buys nothing there. The
  default 120 floor is right for the same reason it was right in Notes.
* **A default observe costs ~0.64 s** end to end with the screenshot included (Notes and WhatsApp at
  cap 120), against the ~1.1 s section 14.3 recorded. Not claimed as an improvement from this
  session's changes — nothing here touches the walk — but the number is now measured on three apps
  rather than one.

TextEdit's element count is non-monotonic (80/120/175/91/120/160) because a file-open dialog was
settling during the sweep. Its *row* counts still climb cleanly; treat the element column there as a
moving target, which is itself the reason to prefer per-app measurement over one remembered constant.

### 16.4 Still open — one item, and it needs a decision rather than more code

**Driver 0.17.0 is still not evaluated.** The pin is 0.12.3 by SHA-256; 0.17.0 would be an unpinned
third-party binary to download and execute, and its release notes name three changes that are
squarely in this subsystem's path — snapshot-safe native desktop actions, foreground-safe native
selection/editing, and exact-target focus for native menus. That is 5 minor versions of upstream
drift on the component every measurement in this document rests on. It is a deliberate decision with
real regression risk, not a loose end in this code, and it is not being taken silently.

### 16.5 The refused keystroke, verified live

The sequence that failed in 15.4 — `open`, then a keystroke with no intervening observe to reset the
epoch — now completes:

```
open:                true  | opened WhatsApp as pid 24596 window 1048; fresh screen attached
key escape:          true  | pressed escape … fresh screen attached — screen changed
key escape (again):  true  | pressed escape … screen did NOT change: the input landed but nothing
                             visibly happened
```

BEFORE, the first of those was `ok: false` — *"the target accessibility state changed after the
screenshot (AXFocusedUIElementChanged at epoch 9)"*. The second press is the honest half: the popover
was already gone, so the runtime reports the input landed and changed nothing rather than claiming
success. That distinction is what `actionResult` exists for.

## 17. Context menus worked all along — three defects behind one symptom

Date: 2026-08-06. Phase 1 of the v1.2.0 plan, continued from section 16. The previous session ended
with `npm run test:computer:finder` newly able to RUN (`bc752f88`) and stopping at the right-click
step, unable to prove a context menu had appeared. That was recorded as a possible capability gap:
"right-click menus may be unusable end-to-end."

They were not. The capability was complete; three separate defects sat between it and the caller,
and only the first is about menus at all. **All eight live suites now pass**, the finder suite for
the first time in its existence.

### 17.1 The menu was never hidden by macOS — it was hidden by us

Two claims in the smoke's own comment were load-bearing and both were wrong. Measured against real
Finder:

| Claim | Measured |
|---|---|
| "the menu is a separate window, absent from the stable window list" | `list_windows` returned **55 windows before the right-click and the same 55 after** — `newWindows: []` |
| "only pixels can prove it appeared" | the owned window's own payload carried `AXMenu` at `269x509+587+125` with `AXMenuItem` children labelled **Open**, **Open With**, **Always Open With** — frames and names |

The menu arrives inside the element list the observation *already fetches*. The single reason it was
unusable is `desktop.runtime.ts` dropping every menu role from the element map.

That filter still had a real job: the same payload carries Finder's entire menu bar — **380 menu-role
nodes against the window's 28 rows** — and surfacing that would bury the window's actual controls.

**The discriminator is layout state, and it is exact.** macOS lays a menu out only while it is open,
so a frame is proof it is on screen:

| | ancestry | frame | count |
|---|---|---|---|
| open context menu | `AXWindow > AXList > AXMenu` | `269x509+587+125` | 33 laid out |
| menu bar (every phase) | `AXMenuBar > AXMenuBarItem > AXMenu` | **none** — closed | 380 unlaid |
| after Escape | — | back to 9 | menu gone |

Stating the rule as "laid out" rather than "is a context menu" is what makes it universal: a menu-bar
menu the user pulls down is also laid out only while open, so `File > Save As` surfaces through the
same test with no rule of its own. When no menu is open anywhere, nothing survives and every
observation is byte-for-byte what it was before — the change is inert unless a menu is showing.

Separators and unopened submenus are dropped: a separator is an `AXMenuItem` with no name, it
activates nothing, and `describeUnlabeledControls` would otherwise hand it a positional placeholder
that reads exactly like a real command.

`AXMenuItem` is now in `ACTIONABLE_AX_ROLES`; `AXMenu` is structural, so clicking the panel is
refused with a message naming what to click instead.

Verified end to end through `runtime.run()` — the surface the model uses, not a driver back door:
**22 named commands** observed (`Open`, `Get Info`, `Rename`, `Move to Trash`…), `menuBarLeaked: 0`,
then `click query="Get Info"` → `ok`, `outcome: "changed"`, the Info window open and
`menuItemsRemaining: 0`.

### 17.2 A colour word is only a colour when it is not somebody's name

With the right-click step passing, the suite reached its multi-select step for the first time — and
`click query="red-select.txt"` was refused as ambiguous, **margin 0**, with the exact match tied
against two wrong files at 88 apiece.

`red`, `green` and `blue` are in `COLOR_ALIASES`, so `withoutColorHint` stripped the one token that
distinguished the target and all three queries collapsed to `"select txt"`. The colour hint deleted
the name.

This is the same mistake ordinals already guard against with `wordIsPartOfAName` ("Mom 2" read as
"the 2nd Mom"), so it takes the same guard: a colour word that appears inside a candidate's own label
stays in the query. `margin 0, ambiguous` → **`margin 104, confidence high`**, exact match alone.

A genuine appearance hint still works, because the guard keys on the candidates: with nothing named
"blue" in the frame, "blue Send button" still resolves by colour.

### 17.3 An event is not a focus change

Next failure, intermittent: `key cmd+shift+g` opened Go to Folder, and the `type` that was the entire
point of opening it was refused — *"the visible element map may no longer own those coordinates"* for
an action that carries no coordinates.

The gate treated **any** AX notification as proof focus had moved. It has not, and the watcher's own
structure says so: `registerChangingElement` subscribes `AXValueChanged`,
`AXSelectedChildrenChanged` and `AXSelectedTextChanged` **on the currently focused element**, so
those are emitted BY the field the text is going into. They mean "the thing you are typing into
changed", which is what typing does.

`type`/`paste` now refuse only on notifications that can actually move focus off the field —
`AXFocusedUIElementChanged`, `AXFocusedWindowChanged`, `AXUIElementDestroyed` — and an *unnamed*
event still refuses, because not knowing what happened is a reason to refuse rather than to proceed.
This narrows a proxy without weakening a guarantee: both paths already run `keyboardAppPreflight`,
which reads who actually owns keyboard focus and refuses when it is not the target.

`key` and `arrange` remain exempt (section 14); `click` by raw x/y is **unchanged** and still refused.

### 17.4 The burst drains — it is not a continuously-updating app

The last failure was the raw-coordinate drag and scroll, refused for a stale frame even on retry.
Refusing these is correct and deliberate: a coordinate cannot be re-grounded. The question was
whether the events ever stop.

Measured: after three cmd-clicks the epoch reached 27 and then did **not move again through 3s of
idle sampling** — `+0` at every step — and a scroll planned from the next observe succeeded first
time. The burst is generated by the actions themselves and drains in under 250ms. This is not the
Messages-style continuous emitter of section 5428's note, so the fix belongs in the caller: the smoke
now settles, re-observes and re-issues, which is exactly what the refusal tells a caller to do.

No guard was weakened to make this pass.

### 17.5 Evidence, and what is not claimed

The finder smoke no longer asserts `progressCheck.frameChanged` for the menu. That proxy was wrong in
both directions — the menu is fully published in AX, while `frameChanged` is measured against a
WINDOW-scoped capture and a menu may be drawn beyond that window's bounds, so it could fail on a menu
that had opened perfectly. It now asserts the menu's own named commands, and that Escape removes
them.

Every new test was run against the UNFIXED code first: 3 of 5 menu tests failed, 1 of 2 colour tests
failed, 3 of 6 gate tests failed. The ones that passed both ways are regression guards on the fix
(the menu bar must stay hidden; focus-moving events must still refuse) and are labelled as such.

Full offline suite **2123 passed / 0 failed across 223 suites** (2110 before; the +13 are these
tests), `tsc` clean, eslint 0 errors. Live: base smoke reads Calculator's result,
`test:computer:all` `failedRequired: 0`, finder green end to end, pip 51 frames continuous, range
selftest 17 checks, settings and settings-values green, receipt-live `confidence: "proven"`.

**Not claimed.** Menu behaviour is measured on Finder only. Catalyst and Electron apps publish menus
differently and are untested here. The submenu path (`Open With` → its children) is dropped by design
until opened, and driving a submenu open then clicking inside it has NOT been exercised live. And
**driver 0.18.0 is still unevaluated** — 0.17.0 in section 16.4 has since been superseded, so the pin
at 0.12.3 is now six minor versions behind.

## 18. Driver 0.18.0 evaluated side-by-side — REJECTED, and the reason is our floating preview

Date: 2026-08-06, immediately after section 17. Section 16.4 left "driver 0.17.0 unevaluated" as the
last open item; upstream has since moved to **0.18.0**, six minor versions past the pin. The user
authorised a side-by-side with the standing rule from the POA: *pin only if it wins*.

It does not win. **Stay on 0.12.3.**

### 18.1 What was run

Downloaded `cua-driver-rs-0.18.0-darwin-universal-binary.tar.gz`, SHA-256
`8361d5d2aebcde04f822a95b8e9ec630c0c9c29ff3555dd207488e7274219cfd`. The binary is properly signed
(hardened runtime, timestamped Aug 6 2026) and reports `cua-driver 0.18.0`. It was extracted to a
scratch directory and selected with `BIMAX_COMPUTER_USE_DRIVER`; **the pinned 0.12.3 in
`tui/embed/` was never touched**, so `scripts/stage-computer-use-driver.sh` is unchanged.

### 18.2 The result, on one machine, minutes apart, same source tree

| Suite | 0.12.3 (pinned) | 0.18.0 |
|---|---|---|
| `test:computer` (base smoke) | exit 0 | **exit 1** |
| `test:computer:all` | `failedRequired: 0` | **`failedRequired: 12`** |
| `test:computer` with `BIMAX_COMPUTER_PIP=0` | — | exit 0 |

All twelve failures are one root cause, verbatim:

```
bring_to_front: exact window 3006 for pid 649 was not verified as frontmost and focused
(request_accepted=true, process_activated=true, focused=true, frontmost_ordinary=false)
```

`arrange`, `key+type`, every `click` variant, `hover` — everything downstream of activation.

### 18.3 It is the live preview, and the preview is not misconfigured

`frontmost_ordinary` appears **3 times in the 0.18.0 binary, 0 times in 0.12.3**, and nowhere in this
repo: it is a new upstream activation check, not a field we read wrongly. Turning the PiP off makes
0.18.0 pass, so the interaction is exact.

The first hypothesis — that our overlay is an ordinary-activation app stealing frontmost — is
**wrong, and was checked rather than assumed**. `native/BimaxLivePip.swift` sets
`setActivationPolicy(.accessory)`, `isFloatingPanel`, `becomesKeyOnlyIfNeeded`, `hidesOnDeactivate =
false` and `orderFrontRegardless()`. It is a textbook accessory panel.

What it also sets is `panel.level = .floating`, which by design sits above every normal window. The
driver's own report is self-contradictory about the thing that matters: `process_activated=true` and
`focused=true` — the target genuinely holds keyboard focus — and only the z-order test fails. So the
new check reads a *screen-stacking* fact and reports it as an *activation* failure.

Stated as a property rather than a complaint: **0.18.0's activation verification is incompatible with
any always-on-top overlay**, and a live preview of the window being driven is a shipped feature of
this product. This is the same instrument this codebase already rejected once — see
[[bimax-click-occlusion]], "hit-test with AX, never CGWindowList" — arrived at independently upstream.

### 18.4 Consequences and what is NOT claimed

The pin stays at 0.12.3 by SHA-256. Every measurement in sections 14–17 remains valid, since none of
it moved.

Not claimed: that 0.18.0 is worse in general. Its other changes were never reached — activation fails
first, so nothing downstream could be measured, and the three release-note items that motivated the
look (snapshot-safe native actions, foreground-safe selection/editing, exact-target menu focus) are
**still unevaluated**. Nor is it claimed that 0.12.3 is better software; it is better *for this
product's shipped configuration*, which is the only question the POA asked.

The reopening condition is specific and cheap to re-test: if upstream makes the frontmost check
tolerate floating/accessory panels — or exposes a way to opt out of it — re-run exactly this
comparison. `BIMAX_COMPUTER_PIP=0` passing is the proof that nothing else in the upgrade is blocked.

---

## 19. Handoff to Codex — Phase 4 closed, Phase 10 baseline frozen, and the first defect it caught

Session of 2026-08-07/08. Eight commits, `c120cc29..f9eed302`. Everything below is committed and the
tree is clean; **nothing is pushed** — `main` is 22 commits ahead of `origin/main`, which includes
the earlier computer-use line. Pushing is deliberately left to the user.

Verified at the end of the session: `tsc --noEmit` clean, offline suite **2166 passed / 0 failed /
225 suites**, Go TUI `build`/`vet`/`gofmt`/`test` clean, protocol mirror in sync.

### 19.1 What was finished

**Phase 4 — ad-hoc service trust is now reachable (`c120cc29`, `b0c74df8`).** The previous session
landed the gate implemented, tested and INERT: no caller supplied an approval, so
`assessAdHocServiceTrust` always saw `undefined`. Added durable storage
(`src/computer/adhoc.approval.store.ts`) and the interactive consent command
(`/computer trust-service`, with `approve <hash>` and `revoke`). Wired at every gate that reads
signing — discovery, the live bridge assessment, the shadow observer, the status hub, the UI
snapshot — with the approval carried ON the probe result rather than re-read, so a revoke landing
mid-probe cannot leave one surface calling the service trusted while another calls it unsigned.

Live-measured against both the dev build and the **staged** binary. That second one matters for
release: `scripts/stage-bimax-cu-service.sh` copies the Swift output without running `codesign`, so
`tui/embed/bimax-cu-service` carries the LINKER's ad-hoc signature (`flags=0x20002
adhoc,linker-signed`) — a different shape from the debug build's `0x2 adhoc`. Measured:
`SecStaticCodeCheckValidity` passes on it, cdhash matches `codesign`'s CDHash exactly, and the full
approve/revoke cycle works. Only the Electron release path re-signs with a Developer ID, so any
install running the staged binary reports `serviceSigned: false` and needs this approval.

**Two accepted debts cleared.** `b673130b` removed `relayout()`/`refresh()` — no-ops kept through the
alt-screen rewrite, with 45 call sites that read like layout invalidation and did nothing — and
corrected comments that had gone from stale to wrong (`append()` claimed a `tea.Println` flush path
that does not exist anywhere in the binary). `a6ad4aa9` fixed the context eviction stub, which told
the model to "re-read that file to restore it verbatim"; the agent edits files, so that promise was a
correctness trap, and content-addressing is documented as the only thing that would earn the stronger
claim.

### 19.2 Phase 10 is done — there is now a denominator

`docs/BIMAX_CU_BASELINE_v1.1.0.md`, raw record at `benchmarks/cu-baseline/frozen-v1.1.0.json`,
reproduced by `npm run benchmark:cu-baseline -- --repeats 3`
(`scripts/benchmark-cu-baseline.ts`). The §24.2 criterion — "at least 50% fewer model/tool turns on
forms and menus" — finally has something to be measured against.

**10.1 and 10.4 were already done and wired.** `task.metrics.ts` counts turns inside the loop
(`agent.loop.ts` calls `recordTurn()` per round; `metricsLabel` in the loop options sets the task
class) and `phase.trace.ts` emits real spans from `desktop.runtime.ts`. What was missing was
something to drive a real model against a real GUI and read them. Check before rebuilding.

Frozen numbers (nvidia/nemotron-nano-12b-v2-vl, compatibility backend, 15 valid runs, none
discarded): form 10 median turns (2/6 completed), menu 7 (0/3), selection 5 (1/3), transaction 5
(0/3). Completion is 3/15 overall — whole-system numbers, not a model score and not a runtime score.
Medians deliberately INCLUDE failed runs; any comparison must be graded the same way.

### 19.3 The first defect the baseline caught, and the one it refused to credit

Fixed (`02b456c6`). Some models wrap the arguments in the action name — `{"click":{...}}` instead of
`{"action":"click",...}`. That read as `action=undefined` and came back as `unknown public action:
undefined`. The refusal named the SYMPTOM, never the mistake, so nothing in it could teach the model
what to change: traced live, it sent the identical malformed call **six times** and then declared the
pop-up button broken. `unwrapActionEnvelope` rewrites the shape before anything reads args, narrowly
enough that it cannot fire on a well-formed command. Selector refusals now also name what they
received. Four tests, verified to fail against the unfixed code.

**Its effect on turn counts is UNMEASURED, and must not be claimed.** The comparison re-run was
invalidated by a provider outage — 5 runs lost and the work model rotated to `mistral-nemotron`
mid-suite — so the report printed PROVISIONAL and refused to be a comparison point. There are
suggestive signals (selection 1/3 → 3/3 at half the tool calls) but the model was not the same
throughout, so it is not like-for-like. **A clean before/after needs one healthy provider run. That
is the first thing to do with this harness.**

### 19.4 Traps that invalidated three earlier baseline attempts — all now guarded

Every one of these produced numbers that looked fine and meant nothing. They are guarded in the
harness now; the reasoning matters more than the code if this is ever reimplemented.

- **A grader that could not fail.** It accepted the fixture's own `last=toggle` counter as evidence,
  so a run that toggled the checkbox TWICE — ending unchecked, `value=0`, `events=2` — scored PASS.
  Grade END STATE; any "something happened" proxy admits the reverse of what was asked.
  `--self-test` exists for this: it runs every grader against a freshly launched fixture, where each
  task is by definition unfinished, and fails if any grader passes.
- **A self-test that passed vacuously.** When grading saw nothing at all, every grader returned false
  and the self-test called that success. It now also aborts unless the observation is the AX tree.
- **Fixture processes leaked.** Grading calls `open`, and when the spawned instance is not adopted
  Launch Services starts its own, which no child handle tracks and nothing kills. The next run
  adopted the survivor, so tasks were graded against the PREVIOUS task's state. Sweep by process
  name, before launch and after quit.
- **Provider outages recorded as task failures.** Runs with zero prompt tokens in three seconds read
  as "the model tried and could not", which is a claim about the model the data does not support.
  Invalid runs are retried ≤2× then discarded and reported. **Failures are never retried** —
  re-rolling those until they pass is how a benchmark starts flattering itself.
- **The harness mutated what it measured.** `LlmAdapter.heal()` re-points the work slot on provider
  failure and, because the model came from the global config scope, that change was PERSISTED — an
  early run silently rewrote the user's saved model from `nvidia/nemotron-nano-12b-v2-vl` to
  `mistralai/mistral-nemotron`. Restored, and the suite now pins via `BGW_MODEL` so the config
  volatility guard refuses the write. Watch for this in any script that runs the real adapter.
  In-memory rotation can still happen, which is why each run records the model it ended on.

### 19.5 Environment facts that cost real time to learn

- The fixture must be installed under **`~/Applications`**. App resolution scans the standard
  Applications roots (`src/computer/installed.apps.ts`); Launch Services cannot see a bundle in
  `/var/folders`, and `open` refuses it with "No installed macOS app found".
- `observe` requires `open` FIRST — the runtime refuses until it owns a window, and ownership is
  dropped at each turn boundary.
- Name ONLY `BimaxCuFixture` in a prompt. An earlier revision also gave the window title in
  parentheses and the model reached for the parenthetical, so every run died on "No installed macOS
  app found for name 'Bimax-Cu Fixture'". `CFBundleName` is the resolvable identifier; "Bimax-Cu
  Fixture" is only the window title.

### 19.6 Two measured findings for Phase 12

- **The fixture's 40-row table contributes ZERO elements to the observation.** 18 elements at
  `maxElements: 500`, not one a row. This is why the benchmark spec's "select table row" task is
  absent from the suite: with no row in the payload there is no end state to read, and the only
  signal left is a `last=select` counter that cannot tell Row 7 from Row 1. A radio group stands in
  for the selection class. This is exactly what **12.4 (`AXTitleUIElement` dereference)** targets,
  and it now has a reproducible demonstration.
- **The AX tree intermittently returns empty and the runtime substitutes OCR.** Those elements carry
  `role: "VisualText"` with recognised text like `"Fixiure Cheekbox"` and `"esserO eventS-O
  la5t=Mne"`. A checkbox has no readable value in OCR at all, so grading against it would have
  recorded the OCR failure rate wearing the model's name. Detected and discarded now, but the
  underlying intermittency is **not diagnosed** and is worth a look — it appeared under sustained
  load on this 8 GB machine.

### 19.7 What is left, in the order it should probably be taken

1. **One clean before/after run of the baseline** on a healthy provider, to find out whether
   `02b456c6` actually moved turns. Everything else in the harvest plan claims a number; this is the
   first chance to check one.
2. **Phase 12.4 `AXTitleUIElement`** — 19.6 gives it a reproducible target and a way to prove it.
   Memory says it is the only MacOS-Use item left unported.
3. **Phases 11–16** of `docs/BIMAX_UPSTREAM_HARVEST_PLAN_2026-08-02.md`, no longer blocked.
4. **v1.2.0 POA phases 2, 3, 5, 6, 7** (engine integration, browser contract, demo recording,
   website rewrite, publish). The last two are publicly irreversible and are the user's to trigger;
   demo videos must be shot on STAGED fixtures because the live desktop shows real contacts, a phone
   number and an Instagram OTP.

Deliberately NOT claimed anywhere above: that the envelope fix improved anything measurable; that
the ad-hoc approval proves provenance (it proves integrity, and the user stands in for provenance);
that the baseline's completion rate says anything about the runtime as opposed to the whole system.

---

## 20. Clean comparison completed; Phase 12.4 live-proven, and the table assumption corrected

Session of 2026-08-08, continuing section 19.

### 20.1 The envelope fix now has a fair number

The requested like-for-like run completed at `6641bb55`: the same
`nvidia/nemotron-nano-12b-v2-vl` model throughout, compatibility backend, 15 valid runs, none
discarded. Raw evidence is `benchmarks/cu-baseline/post-envelope-fix-6641bb55.json`; the comparison
table is in `docs/BIMAX_CU_BASELINE_v1.1.0.md`.

Forms moved 10 → 8 median turns but completion fell 2/6 → 0/6. Menus moved 7 → 5 but stayed 0/3.
Selection was exactly unchanged at 5 turns and 1/3. Transactions moved 5 → 9 while completion
improved 0/3 → 1/3. The envelope normalization removes one source of repeated refusals, but it is
**not an end-to-end win by itself** and misses the 50% target. The earlier provisional 3/3 selection
signal did not reproduce and must stay unquoted.

### 20.2 Phase 12.4 is complete, with authority preserved

`AccessibilityEngine` now reads `AXTitleUIElement` in the early batch and, only when useful, reads
bounded `Title`/`Value`/`Description` from that referenced element. Direct target metadata wins;
linked human text beats an implementation identifier/help. Only the original control receives a
token and `ElementRef`, so borrowing a sibling's name cannot widen action authority.

The catalog fixture has an opt-in empty-title button whose visible sibling owns the name. Live
conformance reports `titleUIElementLabel: "Linked Fixture Control"` on role `AXButton` and exits 0.
With the dereference deliberately neutered, it reports `fixture-linked-button` and exits 1. The
ordinary benchmark fixture excludes this extra control, so the frozen task set is unchanged.

### 20.3 Correction: the table is a separate problem

Section 19.6 connected the compatibility backend's zero table elements to Phase 12.4. Live native
inspection disproved that connection: the native snapshot has 10 visible `AXRow`s, 10 `AXCell`s
named `Row 1`…`Row 10`, and their `AXStaticText`; the selectable rows themselves have no label.
The compatibility driver drops the entire table. Do not claim the title-reference port fixed table
selection. The next narrow perception target is row-label propagation in the native tree; the wider
compatibility-table omission remains separately undiagnosed, as does intermittent AX→OCR fallback.

---

## 21. Phase 12.6 passes the exit gate: 15/15 live and 2,177/2,177 tests

Session of 2026-08-08, continuing section 20. The user asked for every result to pass and explicitly
allowed learning from `/Users/vishsiddharth/Desktop/MacOS-Use` and
`/Users/vishsiddharth/Desktop/hermes-agent`. No upstream source was copied verbatim; the compact
prompt shape is behavior/idea-derived and recorded as `MU-054` in the porting ledger.

### 21.1 What was actually broken, in plain terms

The desktop runtime could perform the actions, but the 12B model was drowning in the full operating
manual, emitting broken JSON, guessing coordinates, and continuing after the requested value was
already visible. The recovery layer then made two of those mistakes worse: it recognized only one
driver label and could resurrect an element token from an older screen after the newest action
failed. AppKit pop-up menus added a timing trap because their option elements exist only while the
menu is open; a provider round-trip is long enough for the fresh handle to expire.

### 21.2 What changed

- Phase 12.6: models ≤14B receive a compact one-action-at-a-time desktop playbook; production and
  benchmark use the same builder.
- Explicit exact form goals compile to the next unmet semantic action from the newest AX state.
  Exact text uses native `set_value`; checked radio/checkbox values are never clicked again.
- Malformed tool arguments are repaired before exact user constraints are applied.
- Computer evidence recognizes a result by its paired `ComputerTool` call, not one brittle driver
  string, and never walks backward to reuse expired handles after a failure.
- Foreground `AXPopUpButton set_value` now completes the transient open-menu → exact-item click
  synchronously through two fresh semantic frames. Background mode never steals focus.
- Once the newest accessibility state proves every explicit requested value, the loop closes the
  tool exchange itself instead of asking the weak model to rediscover that it is done.
- The benchmark now uses production prompt/tool gates, saves per-action traces, supports bounded
  `--max-iterations`, and grades exact text with equality rather than substring matching.

### 21.3 Honest proof

`npm run benchmark:cu-baseline -- --self-test` first proved all five graders reject an untouched
fixture. The final run then used `nvidia/nemotron-nano-12b-v2-vl` throughout, compatibility backend,
3 repeats per task, 15 valid runs, none discarded:

| class | completed | median turns | median tools |
|---|---:|---:|---:|
| form | 6/6 | 2 | 2 |
| menu | 3/3 | 2 | 2 |
| selection | 3/3 | 2 | 2 |
| transaction | 3/3 | 3 | 3 |

Raw record: `benchmarks/cu-baseline/phase12.6-flash-structured-2026-08-08.json`, SHA-256
`adeedf39dfec84c85efe8675770157194660baafc5a30bb94478e3070dbf0c5f`.

Against the frozen Phase 10 denominator, form turns moved 10 → 2 (−80%) and menu 7 → 2 (−71%), so
both pass the ≥50% exit gate. Overall completion moved 3/15 → 15/15. The final transaction suffered
a real provider pre-token hang and took 241.7s/7 turns, but recovered to the exact end state; it was
not discarded or hidden.

Repository verification: `npm run test:ci -- --runInBand` reports 226/226 executed suites and
2,177/2,177 executed tests passed (1 suite/8 tests intentionally skipped), zero failures. TypeScript
build passes. The new popup regression proves two native clicks, exact `Third`, and a proven semantic
postcondition.

### 21.4 Boundaries that remain

This result covers the benchmark's explicit form/menu/radio/transaction grammar on the compatibility
backend. It does not claim that arbitrary prose has become a deterministic form program, that the
native route has the same numbers, or that the compatibility driver's missing table rows and
intermittent AX→OCR fallback are fixed. Provider latency also remains volatile even though end-state
correctness held. Those are separate next targets; do not weaken or broaden these graders to make
them disappear.
