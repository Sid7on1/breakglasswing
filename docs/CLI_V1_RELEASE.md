# Bimax CLI v1.0.4 public beta

Date: 2026-07-18

`v1.0.4` is the Phase 2 reliability and performance release. It keeps the dedicated Work, Quick,
and Vision model slots introduced in v1.0.3 and hardens the execution layer underneath them.

## Highlights

- **Faster first token:** remote pre-flight classification is gone. Routing is local and
  deterministic, removing a full serialized model round-trip from every ambiguous turn.
- **Configuration scopes:** environment overrides beat project/global files and runtime healing can
  never persist an environment-sourced model into the user's configuration.
- **Durable task workspaces:** background shell and browser work is journaled, independently
  cancellable, honestly resumable after a crash, and visible in the TUI task panel.
- **General failure memory:** repeated tool failures have per-class retry budgets, so the agent must
  change strategy instead of looping indefinitely.
- **Native computer use:** the vision slot now receives screenshots correctly and first-party
  desktop control is available without an MCP dependency.
- **Truthful diagnostics:** stream preambles no longer corrupt provider/key latency measurements;
  `bimax --version` reports commit, tree state, build time, and channel provenance.
- **Fault injection and structural gates:** ledger/config/spawn failures have tested recovery paths,
  while the Graphite & Ember design language is enforced in CI.

## Launch gate

`npm run release:check` passed all ten stages:

1. TypeScript production build.
2. Protocol v3 mirror (18 message tags, byte-identical generated contract).
3. 170 engine suites and 1,271 assertions, including real Chromium interaction.
4. Go TUI tests.
5. Self-contained host binary build.
6. Artifact version and help identity.
7. Clean isolated installation.
8. First-user dogfood: packaged TUI, CLI help, and built site all passed.
9. Seven-task deterministic autonomy-pipeline smoke (7/7; kept separate from the live score).
10. SHA-256 checksum.

## Release artifacts

The release contains four self-contained archives and `SHA256SUMS`. Every published asset receives
a GitHub artifact attestation backed by Sigstore. When Apple credentials are configured, the tagged
release workflow also signs, notarizes, and repackages the two macOS binaries; the attached
`SHA256SUMS` is always authoritative for the published release.

Use the attached `SHA256SUMS` file for the exact v1.0.4 archive digests.

## Publish checklist

- Commit the verified CLI/TUI source and this evidence on the release branch.
- Merge or select that commit as the release target.
- Optionally add the five Apple credential secrets documented in `docs/INSTALL.md`.
- Create tag `v1.0.4`; the release workflow builds, checksums, attests, and uploads all five release
  assets. With Apple credentials it also signs and notarizes the macOS binaries; without them it
  clearly labels the macOS release as an unsigned beta.
- Confirm the one-line installer on one clean macOS host and one clean Linux host.

## Honest scope

This is a technically verified public beta. It is not evidence of a completed
multi-hour private beta. The expanded live autonomy suite subsequently passed 7/7 in one
production-provider run with no retries or result selection. Sustained fault injection, external
no-help beta feedback, optional Apple credential provisioning, and post-launch feedback remain visible in
`docs/MASTER_CLI.md`.
