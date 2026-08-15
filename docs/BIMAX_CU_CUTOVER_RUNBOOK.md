# Bimax-Cu Phase 9 cutover runbook

Status: implementation complete for Bimax 1.1.0; signed-release and elapsed-time gates remain
release-operator evidence, not repository claims.

## Runtime modes

`BIMAX_CU_NATIVE_ROLLOUT_MODE` accepts `off`, `manual`, `cohort`, or `native`. Bimax 1.1 defaults
to `native` on macOS and `off` elsewhere. This flag never bypasses the live protocol, Developer-ID
signing, Accessibility, Screen Recording, AX diff/event, verified semantic catalog, capture, or
focus-lease gates. `ComputerTool` remains registered throughout the fallback release.

The equivalent operator commands are:

```text
/computer backend status
/computer backend compatibility
/computer backend native
/computer backend cohort
/computer backend reset
```

Mode changes take effect immediately for already-registered native tools. Restart after enabling a
mode if native schemas were absent at boot. A safety trip is sticky across restarts and is not
cleared by switching modes; only the explicit `reset` command or a new rollout id clears it.

## Ad-hoc service approval

A service without a Developer-ID identity is refused by default. Since 2026-08-07 the user can
approve one on evidence instead — the seal is verified by measurement, and the user stands in for
the provenance check Developer-ID would otherwise provide:

```text
/computer trust-service
/computer trust-service approve <codeDirectoryHash>
/computer trust-service revoke
```

This matters to operators and not only to developers: `scripts/stage-bimax-cu-service.sh` copies the
Swift build output without running `codesign`, so the staged `tui/embed/bimax-cu-service` carries the
linker's ad-hoc signature (`flags=0x20002(adhoc,linker-signed)`). Only the Electron release path
re-signs with a Developer ID. Any install running the staged binary therefore reports
`serviceSigned: false` and needs this approval — or stays on compatibility.

The approval is recorded per exact `codeDirectoryHash` in
`~/.breakglass/computer-service-approval.json` (or under `BIMAX_BREAKGLASS_DIR`), owner-only, and is
read per probe, so approving or revoking takes effect without a restart. Rebuilding or replacing the
service changes its hash and revokes it automatically. It is never an environment variable, and
`BIMAX_CU_ALLOW_UNSIGNED_SERVICE` is a separate, verifies-nothing, development-only hatch.

It yields the advisory blocker `service_ad_hoc_user_approved`, which stays in every assessment: an
approved build is never reported as signed. It clears no MEASURED blocker, so on a service lacking
physical input it makes `assessNativeSemanticOptIn` eligible while full `routingEligible` stays
false — check the semantic gate, not `routingEligible`, when qualifying this path. See
`docs/BIMAX_CU_SECURITY_MODEL.md` for what it does and does not prove.

## Staged cohorts

Automatic cohorts require all four values:

```text
BIMAX_CU_NATIVE_ROLLOUT_MODE=cohort
BIMAX_CU_NATIVE_ROLLOUT_ID=bimax-1.1-ramp-1
BIMAX_CU_NATIVE_COHORT_KEY=<stable opaque installation key>
BIMAX_CU_NATIVE_COHORT_EVIDENCE_APPROVED=1
```

Set `BIMAX_CU_NATIVE_COHORT_BPS` to `500`, `2500`, `5000`, then `10000` for the 5%, 25%, 50%,
and full ramps. Assignment is SHA-256 based and stable for the rollout id/key pair. Keys and rollout
ids are never written to receipts; only a 24-character rollout digest and numeric bucket are shown.

Evidence approval means the release operator reviewed signed shadow results. It is deliberately not
inferred from an environment being capable of shadowing.

## Automatic rollback

The controller retains at most 100 content-free samples. Defaults are a 20-sample minimum and a 10%
failure ceiling. Override only for an approved experiment with
`BIMAX_CU_NATIVE_ROLLOUT_MIN_SAMPLES` and `BIMAX_CU_NATIVE_ROLLOUT_MAX_FAILURE_BPS`.

Correlation failures, malformed responses, protocol faults, and ambiguous timeouts trip
immediately. Availability failures trip when the rolling failure budget is exceeded. Governor
refusals, invalid model arguments, stale app elements, and application-level refusals do not count
against backend health. A failing operation is never replayed through `ComputerTool`; only future
work falls back, because delivery may already have crossed XPC.

State is atomically stored at `~/.breakglass/native-rollout.json` (or under
`BIMAX_BREAKGLASS_DIR`). It contains no task ids, arguments, labels, values, screenshots, AX trees,
or typed content.

## Release packaging

Default macOS CLI artifacts compile the first-party desktop helper at build time and omit the CUA
binary. `ComputerTool` rollback therefore remains usable without `swiftc` or Xcode on the user's
machine. Set `BIMAX_PACKAGE_CUA_COMPAT=1` only for the one-release emergency artifact. Linux keeps
the CUA compatibility sidecar; Bimax-Cu remains macOS-only.

The signed native-XPC default applies to the Electron macOS host, whose live process ancestry can
satisfy the app-boundary gate. The self-contained CLI/TUI keeps using the first-party helper through
the compatibility `ComputerTool`; it must not weaken or bypass the app-ancestor requirement merely
to select the native route.

Electron release CI must supply a Developer ID identity. Verify the app, bridge, and nested service:

```bash
codesign --verify --deep --strict --verbose=2 Bimax.app
codesign -dv --verbose=4 Bimax.app/Contents/MacOS/bimax-cu-bridge
codesign -dv --verbose=4 Bimax.app/Contents/XPCServices/BimaxCuService.xpc
spctl --assess --type execute --verbose=4 Bimax.app
```

Then run `/computer`; `serviceSigned` must be true and the live bridge handshake must independently
pass the semantic gate. A signed release must satisfy this on its own: reaching the native path
through an ad-hoc approval is a defect in the release, not an acceptable substitute, and
`/computer` shows the difference (`signing verified` versus `ad-hoc, approved by you`).

An ad-hoc or local build no longer necessarily stays on compatibility — that was true until
2026-08-07 and is the line to distrust if this runbook looks stale. Such a build can reach the
semantic native path once the user approves it (see "Ad-hoc service approval" above), still without
ever being reported as signed.

## Qualification and retirement gates

Before calling the release stable:

1. Run the full release gate and native 60-test foundation.
2. Run signed shadow comparison against the fixture and real-app matrix.
3. Run the 30-minute interactive soak and the 8-hour release soak.
4. Hold each cohort while reviewing safety and latency budgets.
5. Keep the emergency CUA build reproducible for one complete release.
6. Remove that emergency build only after two stable native releases and one full release with no
   rollback use.

Repository tests can prove the mechanisms. They cannot substitute for signing credentials, elapsed
soak time, or two shipped releases.
