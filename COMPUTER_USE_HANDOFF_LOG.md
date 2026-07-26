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

1. **Shape/contour perception has never fired live** (4.2). Zero shape regions across five apps.
   Needs a deliberate target — an app whose AX tree exposes unlabeled controls that survive to the
   ambiguity trigger — before the feature can be called proven.
2. **WhatsApp yields a menu-bar-only tree** with no window content, no frame, and no Vision
   trigger. The worst tree of the five is the one the ambiguity path missed. This is the single
   biggest correctness gap found.
3. **Sheet-hosted controls may not hit-test** (4.5). Either preflight correctly caught a
   mid-animation sheet, or sheet element frames map into a different space. Clicking a save or
   confirm sheet is common enough that this needs an answer.
4. **Driver 0.12.6** — still pinned at 0.12.3, correctly. Do not touch until 1–3 are settled;
   there is no reason to add sidecar variance while perception gaps are open.
5. The nine inherited commits are gated at the tip only, not individually. If bisectable history
   matters, that needs a pass.

## 7. Standing note on live verification

Anything that drives the real desktop must leave it clean, and must be able to *prove* it left it
clean. Two of the four issues in this session came from a cleanup step that reported success it had
not verified. The receipt architecture applies to the test scripts too, not just the runtime.
