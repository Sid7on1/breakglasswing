# Changelog

All notable changes to BiMax. Dates are ISO 8601.

## [Unreleased] — fix-to-10 hardening

Driven by the frozen Six-Stage Launch Audit. Gates close Must-Fix blockers before v1.0.

- **Repo hygiene** — committed the working-tree baseline; removed 481 MB of stray
  `.bun-build` scratch blobs and a stray `node_modules` conflict symlink; `.bun-build` is now
  gitignored and swept by `build-release.sh`.
- **CI** — added `.github/workflows/ci.yml`: engine typecheck/lint/test + TUI build/vet/test
  on macOS and Linux, plus a protocol-fixture drift check.
- **Docs** — added root `README.md`; corrected `ARCHITECTURE.md` and engine comments that
  described the retired React/Ink front-end as if it were live (the sole front-end is the
  Go / Bubble Tea TUI); collapsed 15 overlapping planning docs into this lean set.
- **TUI render fixes** — the diff card no longer renders git's "No newline at end of file"
  marker as line 1; the green/red diff background no longer bleeds to column 0 after a turn
  commits (the commit path re-wrapped already-fitted rows); overwrite diffs keep monotonic
  line numbers. Regression tests added.
- **Write tool** — no longer silently overwrites an existing file for a new-document request;
  it picks a non-colliding name.

## History

The pre-1.0 build history (dual-model routing, the epistemic/ledger "second mind", the Mind
HUD, blueprint builders, MCP self-healing, the one-click single-binary packaging) is recorded
in the git log and summarized in `FEATURES.md` and `ARCHITECTURE.md`.
