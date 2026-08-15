# Phase 5 frontend references and stored samples

Research date 2026-08-09, performed before implementation. Full source rows and links are in
`../competitive/08_SOURCE_LEDGER.md` under "Phase 5 frontend reset". This file records the
observations themselves and, for each, the decision it produced — the review contract described in
`README.md` ("each changed core journey should be reviewed against the relevant row in
`REFERENCE_MATRIX.md`, then judged against Bimax's own acceptance gates").

## Observations → decisions

| Observation | Source | Decision in Bimax |
|---|---|---|
| A sidebar is for app areas and top-level collections | Apple HIG Sidebars, updated 2026-06-08 | `TaskSidebar.tsx` carries projects and task threads only. Review / Files / Terminal / Agents / Map / Memory / Health left it. |
| No more than two levels of hierarchy | same | project → task threads. Anything deeper is inspector or sheet content. |
| Group with disclosure controls when there is a lot of content | same | Current task and Earlier tasks are separate groups; the full history stays behind "All". |
| Critical actions must not live only at the bottom edge | same | Trust Center is in the title bar, on ⌘⇧T, and in the sidebar — not only in a footer row, which is where Support and Settings used to be. |
| Inspector panes are a legitimate split-view role (Keynote) | Apple HIG Split views | one contextual evidence inspector replaces the icon rail **and** the dock that `CURRENT_BIMAX_UI.md` flagged. |
| Provide multiple ways to reveal a hidden pane | same | title-bar toggle + ⌘J + a palette entry per lane. |
| Set sensible min/max pane sizes; prefer the thin divider | same | inspector 300px–56%, sidebar 190px–30%, 1pt dividers retained. |
| The shipped competitor names the app it controls and promises stop/takeover at any time | ChatGPT Computer Use | Live Target names app + exact window; takeover is on ⌘⇧P, in the task header and in the inspector. Bimax adds evidence age and a per-action end-state confirmation, which that documentation does not describe. |
| An always-allowed app list is a normal expectation | same | recorded as a **Target** — Bimax has per-action approval and a Trust Center history, but no always-allowed list yet. Not claimed. |
| Reduce Motion means tone down large motion, not delete feedback | MDN | transform entrances become an opacity fade; continuous decoration stops; transitions shorten instead of being nulled. |

## What was deliberately not copied

- ChatGPT's always-allowed app list and its settings surface — the capability does not exist here
  yet, and a UI for it would imply one.
- A dashboard of subsystem panels. The Codex-style task-thread model in `03_PRODUCT_EXAMPLES.md`
  already argued against this; the HIG sidebar guidance is the second, independent reason.
- Any competitor's visual language. The graphite/linen foundation, the ember accent and the
  transcript typography are unchanged from the existing Bimax identity.

## Stored artifacts from this phase

| Path | What it is |
|---|---|
| `app/benchmarks/ui/results/phase5/run-*/report.json` | one immutable record per journey run: per-check outcomes, renderer errors, accessibility findings, measurements, mutation results |
| `app/benchmarks/ui/results/phase5/run-*/*.png` | the state each journey graded, captured at the moment of grading |
| `app/benchmarks/ui/results/phase5/electron-*/report.json` | production-boundary record: built Electron main + preload IPC + supervisor + compiled `bimax-mac` stdio provider; safe fake-native target, provider-owned pause/refusal/resume facts preserved |
| `app/benchmarks/ui/results/phase5/electron-*/*.png` | Live Target, paused refusal and post-resume success as rendered through the production boundary |
| `app/benchmarks/ui/screenshots/*.png` | screenshot regression at the three supported window sizes (720×480, 1180×800, 1680×1050) for the task surface, Live Target, receipt and Trust Center |
| `app/scripts/ui/fixtures.mjs` | the deterministic worlds: granted/denied permissions, fresh/stale Mac evidence, verified/failed review, and the malformed-frame corpus |

The screenshots are current-build regression material. They are not marketing assets and no
competitive comparison is derived from them.
