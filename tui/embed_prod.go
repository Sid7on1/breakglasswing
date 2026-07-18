//go:build embedengine

package main

import _ "embed"

// Release build (`go build -tags embedengine`): the bun-compiled engine and the pinned native
// Bimax Computer Use sidecar are baked into the Go binary. The result remains ONE shippable file.
//
//go:embed embed/bimax-engine
var embeddedEngine []byte

//go:embed embed/bimax-computer-use
var embeddedComputerUse []byte
