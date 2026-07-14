# Bimax CLI v1.0.0 public beta

Date: 2026-07-14

## Launch gate

`npm run release:check` passed all ten stages:

1. TypeScript production build.
2. Protocol v3 mirror (18 message tags, byte-identical generated contract).
3. 151 engine suites and 1,065 assertions, including a real Chromium interaction and exact visual-baseline comparison.
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

| Platform | Archive | Pre-sign RC SHA-256 |
|---|---|---|
| macOS arm64 | `bimax-darwin-arm64.tar.gz` | `bf1ac7d918419d9ff8a9aa8b2fb638641a23b3c52d6e411a565b64d293aec9c6` |
| macOS x64 | `bimax-darwin-x64.tar.gz` | `9b8af4c82f5653c009961b08d6f9d47b98131d011fd1a45a396161d934350931` |
| Linux x64 | `bimax-linux-x64.tar.gz` | `2c2558a5c85271ffd0e68c44e546ced380d13135f6869464343d36cd1ec56ab3` |
| Linux arm64 | `bimax-linux-arm64.tar.gz` | `6bebbff14e601253137b9a498a3a8e4820a3c7f16af59276a44baed7a6b291ea` |

## Publish checklist

- Commit the verified CLI/TUI source and this evidence on the release branch.
- Merge or select that commit as the release target.
- Optionally add the five Apple credential secrets documented in `docs/INSTALL.md`.
- Create tag `v1.0.0`; the release workflow builds, checksums, attests, and uploads all five release
  assets. With Apple credentials it also signs and notarizes the macOS binaries; without them it
  clearly labels the macOS release as an unsigned beta.
- Confirm the one-line installer on one clean macOS host and one clean Linux host.

## Honest scope

This is a technically verified public beta. It is not evidence of a completed
multi-hour private beta. The expanded live autonomy suite subsequently passed 7/7 in one
production-provider run with no retries or result selection. Sustained fault injection, external
no-help beta feedback, optional Apple credential provisioning, and post-launch feedback remain visible in
`docs/MASTER_CLI.md`.
