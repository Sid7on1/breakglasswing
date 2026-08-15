# Phase 3 — engine boundary research and implementation record

Date: 2026-08-09

Status: **Implemented and locally Measured.** The Phase 3 exit was exercised in a temporary Desktop
checkout containing no Terminal `src/`: Desktop typecheck and production renderer/main/preload build
passed there. Publishing the assets to the external release repository still requires a real tag
workflow/promotion event; no remote release was fabricated during this local run.

## Research performed before implementation

The mandatory product-reset architecture, split runbook, roadmap, gates, competitive gap/build
records and Mac Buddy vision were reread before editing. The source inventory then found reusable
pieces rather than a blank protocol/release layer:

- NDJSON framing and the engine `ProtocolHost` already existed;
- type-checked current message fixtures and strict Go fixture decoding already existed;
- Desktop's TypeScript mirror was already generated from the engine contract;
- release CI already built both Mac architectures and published checksum-bearing archives;
- Desktop already failed closed to its bundled engine in a packaged app;
- supervisor tests already covered crash, hang, malformed frames and resume.

The missing product seam was narrower: semantic compatibility and feature identity in the
handshake, a JSON Schema/client package, raw engine release assets/manifest, and a Desktop artifact
consumer that never compiles adjacent Terminal source.

External evidence was revalidated against current first-party documentation:

- GitHub release assets expose a `sha256:` digest, and immutable releases/local assets can be
  checked with `gh release verify` / `verify-asset`;
- GitHub artifact attestations bind a build to repository/workflow/commit but only add value when
  consumers verify them; availability for private repositories depends on plan;
- JSON Schema documents must declare their dialect with `$schema` so validators do not guess.

Sources: [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations),
[GitHub release integrity](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity),
[GitHub release assets](https://docs.github.com/en/rest/releases/assets), and
[JSON Schema dialect declaration](https://json-schema.org/understanding-json-schema/reference/schema).

## Samples, examples and data retained

These are committed inputs, not claims inferred from this prose:

| Artifact | What it preserves |
|---|---|
| `src/protocol/schema/fixtures.json` | One typed fixture for every current inbound/outbound discriminator. |
| `src/protocol/schema/protocol.schema.json` | Draft 2020-12 schema for one decoded NDJSON frame. |
| `src/protocol/schema/golden/current-v3.json` | Hello/ready, transcript, approval, interrupt, resume, crash recovery and malformed-frame samples. |
| `src/protocol/schema/golden/previous-v2.json` | Previous supported engine behavior and explicit degradation (no typed resume/controls/hello). |
| `app/engine.lock.json` | Engine version, immutable manifest digest, release base and Desktop protocol window. |
| `build/bimax-engine-manifest.json` | Locally generated per-architecture size/SHA-256, engine/build identity and schema/fixture digests. |
| `build/ENGINE_SHA256SUMS` | Raw engine and manifest checksums for this local build (generated, not committed). |

The generated client package is produced under
`build/protocol/bimax-client-protocol-v3.1.0/` and contains TypeScript, schema, fixtures, golden
journeys and its own checksum map.

## Implemented contract

### Protocol

- Numeric `ready { protocol: 3 }` remains for old clients.
- An additive `hello` now precedes it with engine version, build commit, semantic protocol `3.1.0`,
  compatible major range 2–3, and feature vocabulary.
- Unknown additive frames still remain ignorable. Desktop accepts v2 and v3, refuses a disjoint
  range before becoming ready, and does not send typed resume to v2.
- Both Desktop protocol constants and renderer wire types are generated from the engine source.

### Release and Desktop pin

- Terminal's release matrix copies the exact standalone engine embedded in each Terminal build into
  separate `darwin-arm64` and `darwin-x64` assets.
- The manifest binds version/build identity, protocol/schema/fixture digests, architecture, exact
  byte size and SHA-256. CI archives those assets and the public promotion script includes them.
- Desktop resolves the actual host/target architecture, verifies the pinned manifest digest,
  protocol overlap, artifact size and SHA-256, then atomically stages `app/engine/`.
- `BIMAX_ENGINE_ARTIFACT_DIR` is the offline/CI path. Network fetch is build-time only, streams to
  disk, follows redirects, has a 60-second deadline and at most three attempts.
- `BIMAX_ENGINE_LOCAL_OVERRIDE` is explicit contributor authority and is rejected when
  `BIMAX_RELEASE_BUILD=1`. There is no `dist/index.js`, `npx tsx`, or `bun build src/index.ts`
  fallback in Desktop's engine preparation/launch path.

## Macro vision check

This slice applies the existing research cards; it does not claim the later adaptive-runtime work:

- **V01 Silicon-Aware Architecture:** select by supported architecture (`arm64`/`x64`), never a
  marketing chip name. Both assets are independently sized and hashed.
- **V03 Performance Philosophy:** engine download/verification stays off the app launch path;
  downloads and hashing stream rather than reading an 82–87 MiB executable into renderer memory.
- **V04 Internet-Aware API Architecture:** launch is local/offline. Build-time transfer has bounded
  retry/deadline behavior and cannot weaken digest verification on constrained or failed networks.

Thermal, power, memory-pressure and live `NWPathMonitor` adaptation remain later V01/V03/V04 work;
Phase 3 neither implements nor overclaims them.

## Verification and mutations

`npm run phase3:check` passed on 2026-08-09:

- 100 focused Jest tests after the final compatibility additions (protocol, fixture contract,
  supervisor, bundle resolution and Phase 3 boundary);
- Go TUI suite passed with the generated hello fields and strict fixture decoder;
- arm64 and x64 raw engines compiled; the pinned manifest matched byte-for-byte;
- a live arm64 engine emitted the expected `hello` and `ready` frames;
- app preparation accepted the pinned arm64 artifact;
- app preparation rejected an appended-byte engine and a modified manifest;
- a temporary Desktop-only checkout with no Terminal `src/` passed app typecheck and production
  build.

The final repository-wide regression run also passed:

- 239 Jest suites passed;
- 2,324 tests passed and 6 were skipped (2,330 total), with zero failures;
- the complete Go TUI suite passed;
- the native Swift foundation rebuilt and passed 60/60;
- root TypeScript build, Desktop typecheck/build, shell syntax checks and `git diff --check` passed;
- the local release build produced checksum-valid Terminal archives, both raw engine assets, the
  engine manifest and the versioned protocol package.

The local release was intentionally unsigned because no signing key was supplied. That is honest
local evidence, not signing/notarization evidence.

## What remains outside Phase 3

- A real tag/promotion must publish these new assets; CI configuration is implemented but a local
  run is not proof of remote publication or GitHub attestation eligibility.
- Clean-Mac quarantine/signing/notarization, x64 hardware execution and update rollback remain the
  Phase 7/fresh-Mac release matrix.
- Phase 2's remaining packaged Electron → engine → bridge/XPC forced-action journey is unaffected;
  Phase 3 does not turn component evidence into app-journey evidence.
