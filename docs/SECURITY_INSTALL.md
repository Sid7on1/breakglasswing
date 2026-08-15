# Installing BiMax safely — integrity, signing, and trust

This page is for anyone installing BiMax and for the operator cutting a release. It explains exactly
what is verified, how to verify it yourself, and the current signing status. The website's install
page should link here.

## What the installer guarantees

The one-line installer (`curl -fsSL https://<host>/install | bash`) is **transactional and
fail-closed**:

1. Downloads the platform tarball and the `SHA256SUMS` manifest to a temporary directory.
2. **Verifies the manifest's signature** against a public key pinned inside `install.sh` itself
   (not a key fetched next to the artifacts). If a signature is present it MUST verify or the install
   aborts.
3. **Verifies the tarball's SHA-256** against the (now-trusted) manifest. A mismatch aborts.
4. Extracts into an isolated scratch dir and installs **only** the exact expected binary name.
5. **Atomically replaces** the existing binary and smoke-tests `bimax --version`. If the new binary
   can't run, it **rolls back** to the previous version. A failed update never leaves you broken.

Nothing partially verified is ever executed, and the old binary is preserved until the new one runs.

The Bimax Terminal executable contains the coding engine, Go TUI, and license notices only. It does
not embed the Computer Use driver, service, helper, bridge, or PiP. Native Mac control belongs to
the separately distributed **Bimax.app**, whose bundle layout and hashes must be verified as part of
the Desktop release. See `THIRD_PARTY_NOTICES.md` for source and license attribution; the notice can
also be printed with `bimax --third-party-notices`.

## Verify a download yourself

```bash
# 1. checksum (always available)
shasum -a 256 bimax-darwin-arm64.tar.gz
grep bimax-darwin-arm64.tar.gz SHA256SUMS      # the two hashes must match

# 2. signature over the checksum manifest (when SHA256SUMS.minisig is published)
minisign -Vm SHA256SUMS -P "$(cat bimax-minisign.pub)"
```

The pinned public key also lives in `install.sh` (`MINISIGN_PUBKEY`). Trust is rooted in the script
you already chose to run, so a compromised release host that swaps both the tarball and its adjacent
`SHA256SUMS` still cannot forge a valid signature.

## Bimax for Mac manual alpha

The current Desktop channel is a deliberately **unsigned and unnotarized manual alpha**, not a
stable release. A release is valid only when it includes the DMG, `Bimax-manual-alpha-manifest.json`
(the exact DMG SHA-256 plus every file/symlink in `Bimax.app`), and `SHA256SUMS` (DMG + manifest).

Verify before opening:

```bash
shasum -a 256 -c SHA256SUMS
# Or compare directly with the manifest's dmg.sha256 value:
shasum -a 256 Bimax-1.1.0-arm64.dmg
```

Trust Center shows the running app executable SHA-256, every resolved engine/native component
SHA-256, actual signature kind, and actual Gatekeeper/notarization assessment. An unavailable fact
stays `unknown`; it is never rendered as trusted.

### First open on a fresh Mac

Because this channel is unsigned, Finder should warn for a browser download. Choose **Done**, open
**System Settings → Privacy & Security**, scroll to Security, choose **Open Anyway** for Bimax,
authenticate, and confirm **Open**. This is a manual-alpha bypass, not notarization. Never disable
Gatekeeper globally.

Grant Screen Recording or Accessibility only when a Control Mac task needs it; coding works with
both denied. Replacing `Bimax.app` can make macOS ask for either grant again. Open Trust Center after
every update and re-check before continuing Control Mac work.

### Rollback-safe manual update

Quit Bimax, mount the verified DMG, then use an explicit source and destination:

```bash
node app/scripts/install-manual-alpha.mjs \
  --source "/Volumes/Bimax/Bimax.app" \
  --destination "/Applications/Bimax.app" \
  --manifest ./Bimax-manual-alpha-manifest.json
```

The installer verifies the complete source tree, copies to a sibling staging path, verifies again,
atomically moves the old app to `Bimax.app.previous`, activates/re-verifies the new app, and restores
the old app if the postcondition fails. It refuses to overwrite an existing `.previous` copy.
Project directories are outside the app bundle and are not removed.

Trust Center's **Export private diagnostics…** writes a user-selected local JSON file. It includes
build/signature/hash/permission and bounded crash metadata, but excludes project paths, source/file
contents, transcripts, credentials/environment values, raw logs and crash tails.

## macOS: signing, notarization, and the "no warning" question

Fetching a CLI with `curl | bash` does **not** attach the quarantine flag a browser download gets, so
the absence of a Gatekeeper prompt is **not** evidence that a binary is signed or safe. Verify signing
explicitly:

```bash
codesign --verify --strict --verbose=2 "$(command -v bimax)"   # signed? hardened runtime?
spctl -a -vvv -t install "$(command -v bimax)"                  # Gatekeeper assessment
```

### Release operator — signing the CLI binaries

`release.sh` signs the darwin binaries when a Developer ID identity is available:

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export BIMAX_MINISIGN_SECKEY="$HOME/.minisign/bimax.key"   # signs SHA256SUMS
./release.sh darwin-arm64 darwin-x64
```

Without `MACOS_SIGN_IDENTITY` the build still succeeds but prints an UNSIGNED warning.

### Release operator — qualifying a stable desktop DMG

Code signing (`codesign`) is **not** notarization. Notarization is an Apple-side scan; only a
successful notarization + stapling clears Gatekeeper on a clean Mac. Do not claim notarization from a
local `codesign` pass.

```bash
# Build/staple the signed app before constructing the DMG, then notarize/staple the DMG. This
# script refuses missing credentials, mismatched nested identities, or failed assessments:
export CSC_LINK="/path/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="…"
export APPLE_NOTARY_KEY_PATH="/path/AuthKey_ABC123.p8"
export APPLE_NOTARY_KEY_ID="ABC123"
export APPLE_NOTARY_ISSUER_ID="issuer-uuid"
npm --prefix app run release:stable:mac -- arm64
```

This is necessary but not sufficient. Stable status also requires the quarantined clean-Mac
Gatekeeper/TCC update matrix and a signed update feed with rollback. Never infer either from a
successful local build.

**Current Desktop status (2026-08-09):** local arm64 manual-alpha artifact/hash/rollback gates pass.
No valid Developer ID identity or notary credentials are available here, the configured public
v1.1.0 engine manifest URL returns HTTP 404, and no clean-Mac matrix ran. Stable signing,
notarization, publication, signed updates, Intel packaging and clean-Mac TCC remain Target.

## Uninstall — what each tier removes

```bash
install.sh --uninstall            # removes the executable only
install.sh --uninstall --purge    # also removes ~/.breakglass (your API keys)
```

Per-repo `.bimax/` project data is **never** touched by the installer — it is yours (and may be under
version control). Remove it manually if you want it gone.

## Your API key on disk

BiMax stores your provider key at `~/.breakglass/.env`, created `0600` inside a `0700` directory
(owner-only). On every startup BiMax re-tightens these modes, migrating any older permissive install,
and refuses to follow a symlink planted at that path. See `src/cli/env.loader.ts`.
