//go:build embedengine

package main

import _ "embed"

// Release build (`go build -tags embedengine`): the bun-compiled, self-contained engine binary
// is baked into the Go binary. The result is ONE shippable file with no Node/Bun on the host.
// Produced by build-release.sh, which runs `bun build --compile` into embed/bimax-engine first.
//
//go:embed embed/bimax-engine
var embeddedEngine []byte
