# Installing BiMax

BiMax ships as **one self-contained binary** — the Go TUI with the bun-compiled engine
baked in. The target machine needs **no Node, no Bun, no node_modules**.

## One-click install

On macOS (Apple Silicon or Intel):

```sh
curl -fsSL https://bimax-liard.vercel.app/install | bash
```

The installer detects the platform, downloads the matching release tarball, installs to
`~/.local/bin/bimax`, wires PATH if needed, and verifies with `bimax --version`.

Inside a source checkout (with `bun` + `go` installed), the same script builds locally
instead of downloading:

```sh
git clone <repo> && cd bimax && ./install.sh
```

Overrides: `BIMAX_INSTALL_DIR`, `BIMAX_REPO`, `BIMAX_VERSION`, `BIMAX_BASE_URL` — see the
header of `install.sh`. Downloads are verified against the release's `SHA256SUMS` before extraction.

Update or uninstall using the same script:

```sh
curl -fsSL https://bimax-liard.vercel.app/install | bash -s -- --update
curl -fsSL https://bimax-liard.vercel.app/install | bash -s -- --uninstall
```

## Cutting a release

On a build machine with bun ≥ 1.1 and go ≥ 1.26:

```sh
BIMAX_VERSION=1.2.0 ./release.sh          # darwin-arm64 + darwin-x64
./release.sh darwin-arm64                 # single target
```

Each target compiles the engine with `bun build --compile --target=bun-<os>-<arch>`
(CJS format — ESM mangles the web-tree-sitter glue), embeds it in a cross-compiled Go
binary (`-tags embedengine`), and produces `build/bimax-darwin-<arch>.tar.gz` plus
`build/SHA256SUMS`. Publish both archives, the checksum manifest, and its signature when present to the public
[`Sid7on1/bimax-releases`](https://github.com/Sid7on1/bimax-releases) release; the website
installer pulls from its `releases/latest/download/` endpoint while this source repository
remains private.

### Apple signing and notarization

Tagged releases can be built by `.github/workflows/release.yml` and promoted with
`scripts/publish-public-release.sh`. The credential-gated path is designed to sign with hardened
runtime and a timestamp and submit to Apple's notary service before regenerating `SHA256SUMS`.
Do not describe an artifact as signed or notarized merely because this workflow exists: those facts
require the actual Developer ID, notary, stapler and clean-Mac checks. The current Desktop channel
is the unsigned/unnotarized manual alpha documented in `SECURITY_INSTALL.md`.

The repository must define these GitHub Actions secrets:

- `APPLE_DEVELOPER_ID_P12_BASE64` — base64 of a Developer ID Application certificate plus private
  key exported from Keychain Access as `.p12`.
- `APPLE_DEVELOPER_ID_P12_PASSWORD` — password used when exporting that `.p12`.
- `APPLE_NOTARY_PRIVATE_KEY` — contents of an App Store Connect API key (`AuthKey_*.p8`).
- `APPLE_NOTARY_KEY_ID` — the API key ID.
- `APPLE_NOTARY_ISSUER_ID` — the App Store Connect issuer ID.

Only the Apple Developer Account Holder can create the Developer ID certificate. Add credentials
through **GitHub → Settings → Secrets and variables → Actions**; never commit them or paste them
into an issue or chat. Push a version-matching tag such as `v1.0.0` only after CI is green.

Apple's notary service issues an online ticket for a standalone executable, but `stapler` cannot
attach that ticket directly to the executable. Gatekeeper therefore retrieves the notarization
ticket online when it assesses the downloaded CLI.

`./build-release.sh` remains the single-file build for the current platform only
(`build/bimax`).

## Dev loop (this repo)

```sh
npm run build                    # TS engine → dist/
cd tui && go build -o bimax-tui  # Go TUI (spawns dist/ when fresh, tsx otherwise)
./tui/bimax-tui
```
