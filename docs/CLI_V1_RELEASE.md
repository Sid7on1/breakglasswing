# Bimax CLI v1.0.5 public beta

Date: 2026-07-18

`v1.0.5` replaces the global-coordinate desktop controller in shipped builds with Bimax Computer
Use: PID/window-scoped native observation and action, embedded inside the existing single-file CLI.

## Highlights

- **Faster first token:** remote pre-flight classification is gone. Routing is local and
  deterministic, removing a full serialized model round-trip from every ambiguous turn.
- **Configuration scopes:** environment overrides beat project/global files and runtime healing can
  never persist an environment-sourced model into the user's configuration.
- **Durable task workspaces:** background shell and browser work is journaled, independently
  cancellable, honestly resumable after a crash, and visible in the TUI task panel.
- **General failure memory:** repeated tool failures have per-class retry budgets, so the agent must
  change strategy instead of looping indefinitely.
- **Bimax Computer Use:** `open` returns a PID/window identity; `observe` captures that exact window
  with its fresh accessibility handles; native actions route to that PID without stealing focus;
  cleanup cooperatively quits and verifies that the window disappeared.
- **Truthful visual fallback:** when an app exposes only menu chrome through accessibility, the
  observation is marked degraded and the clean window-only screenshot becomes the grounding source.
  The model cannot treat an empty tree or an unverified action as the requested result.
- **Settings without the blanket veto:** read-only ordinary panes such as Storage are operable.
  Credential/security panes remain hard-denied, and fresh semantic labels feed high-impact approval
  checks for Delete/Grant/Submit-style controls.
- **Private and self-contained:** the pinned MIT native sidecar is SHA-256 verified during the build,
  embedded inside the one Bimax executable, hidden from `PATH`, and run with upstream telemetry off.
- **Honest, compact model UI:** Work, Quick, and Vision choices persist from the Go TUI, the model
  picker keeps advanced controls one level deeper, and duplicate setup messages are collapsed.
- **Truthful diagnostics:** stream preambles no longer corrupt provider/key latency measurements;
  `bimax --version` reports commit, tree state, build time, and channel provenance.
- **Fault injection and structural gates:** ledger/config/spawn failures have tested recovery paths,
  while the Graphite & Ember design language is enforced in CI.

## Launch gate

`npm run release:check` passed all ten stages:

1. TypeScript production build.
2. Protocol v3 mirror (18 message tags, byte-identical generated contract).
3. Engine suites, including the Bimax Computer Use adapter/safety contract and real Chromium interaction.
4. Go TUI tests.
5. Self-contained host binary build.
6. Artifact version and help identity.
7. Clean isolated installation.
8. First-user dogfood: packaged TUI, CLI help, and built site all passed.
9. Seven-task deterministic autonomy-pipeline smoke (7/7; kept separate from the live score).
10. SHA-256 checksum.

## Release artifacts

The release contains four self-contained archives and `SHA256SUMS`. The private source repository's
tagged workflow builds, verifies, and archives that matrix; `scripts/publish-public-release.sh`
promotes the verified assets to the separate public `Sid7on1/bimax-releases` repository. When Apple
credentials are configured, the workflow also signs, notarizes, and repackages the two macOS
binaries. The attached `SHA256SUMS` is always authoritative for the published release.

Use the attached `SHA256SUMS` file for the exact v1.0.5 archive digests.

## Publish checklist

- Commit the verified CLI/TUI source and this evidence on the release branch.
- Merge or select that commit as the release target.
- Optionally add the five Apple credential secrets documented in `docs/INSTALL.md`.
- Create tag `v1.0.5`; the private-source workflow builds, checksums, and archives all five release
  assets. With Apple credentials it also signs and notarizes the macOS binaries.
- Run `scripts/publish-public-release.sh` to promote or replace the verified assets in the public
  `Sid7on1/bimax-releases` release while keeping source and history private.
- Confirm the one-line installer on one clean macOS host and one clean Linux host.

## Honest scope

This is a technically verified public beta. It is not evidence of a completed
multi-hour private beta. The expanded live autonomy suite subsequently passed 7/7 in one
production-provider run with no retries or result selection. Sustained fault injection, external
no-help beta feedback, optional Apple credential provisioning, and post-launch feedback remain visible in
`docs/MASTER_CLI.md`.
