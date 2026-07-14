# Installing BiMax

BiMax ships as **one self-contained binary** — the Go TUI with the bun-compiled engine
baked in. The target machine needs **no Node, no Bun, no node_modules**.

## One-click install

On any macOS (arm64/x64) or Linux (x64/arm64) machine:

```sh
curl -fsSL https://raw.githubusercontent.com/Sid7on1/breakglasswing/main/install.sh | bash
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
curl -fsSL https://raw.githubusercontent.com/Sid7on1/breakglasswing/main/install.sh | bash -s -- --update
curl -fsSL https://raw.githubusercontent.com/Sid7on1/breakglasswing/main/install.sh | bash -s -- --uninstall
```

## Cutting a release

On a build machine with bun ≥ 1.1 and go ≥ 1.26:

```sh
BIMAX_VERSION=1.2.0 ./release.sh          # darwin-arm64 darwin-x64 linux-x64 linux-arm64
./release.sh linux-x64                    # single target
```

Each target compiles the engine with `bun build --compile --target=bun-<os>-<arch>`
(CJS format — ESM mangles the web-tree-sitter glue), embeds it in a cross-compiled Go
binary (`-tags embedengine`), and produces `build/bimax-<os>-<arch>.tar.gz` plus
`build/SHA256SUMS`. Attach all of it to the GitHub release; `install.sh` pulls from
`releases/latest/download/`.

`./build-release.sh` remains the single-file build for the current platform only
(`build/bimax`).

## Dev loop (this repo)

```sh
npm run build                    # TS engine → dist/
cd tui && go build -o bimax-tui  # Go TUI (spawns dist/ when fresh, tsx otherwise)
./tui/bimax-tui
```
