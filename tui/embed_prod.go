//go:build embedengine

package main

import _ "embed"

// Release build (`go build -tags embedengine`): only the bun-compiled coding engine is baked into
// the Go Terminal binary. Native Mac control belongs exclusively to Bimax.app.
//
//go:embed embed/bimax-engine
var embeddedEngine []byte
