//go:build !embedengine

package main

// Dev build (default): no engine embedded. StartEngine falls back to running the engine from
// source (npx tsx) or whatever $BIMAX_ENGINE_CMD points at. This lets a fresh clone `go build`
// without first producing the 85 MB compiled engine (which is never committed).
var embeddedEngine []byte = nil
