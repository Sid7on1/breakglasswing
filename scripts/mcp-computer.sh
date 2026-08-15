#!/usr/bin/env bash
# Stdio entry point for the `bimax-computer` MCP server.
#
# A wrapper rather than a bare command in .mcp.json because the engine must start with the repo as
# its working directory (tsx and node_modules resolve from there) and MCP client support for a `cwd`
# field is not uniform. Resolving the repo from this script's own location keeps it correct wherever
# the client happens to launch it from.
#
# Source, not dist: this server exists to exercise code that is being edited, and a stale dist would
# silently serve the previous build. stderr is left alone — the client surfaces it as server logs,
# which is where a boot failure has to be visible.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
#
# Arguments are forwarded verbatim so the operator can opt into acting verbs from the client's own
# server config — `"args": ["--allow-acting"]` in .mcp.json. Without it the server only observes.
exec ./node_modules/.bin/tsx src/index.ts mcp-computer "$@"
