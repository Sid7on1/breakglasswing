#!/usr/bin/env node

// Launcher for the bimax CLI. The interactive front-end is the Go / Bubble Tea TUI (tui/bimax-tui),
// which spawns the Node engine headless and drives it over the NDJSON stdio protocol. This wrapper
// just locates that binary and hands off — argv, stdio and exit code all pass straight through.
//
// `-p/--print` (one-shot, non-interactive) and `--headless` (engine for an embedded front-end) are
// engine-only modes with no TUI, so those are routed to the Node engine (dist/index.js) directly.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const pkgRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const engineOnly = args.some((a) => a === '-p' || a === '--print' || a === '--headless');

if (engineOnly) {
  require('../dist/index.js'); // print / headless: no TUI, run the engine in-process
  return;
}

const tui = path.join(pkgRoot, 'tui', 'bimax-tui');
if (!fs.existsSync(tui)) {
  console.error(
    `BiMax TUI binary not found at ${tui}\n` +
    `  Build it with:  cd ${path.join(pkgRoot, 'tui')} && go build -o bimax-tui .`,
  );
  process.exit(1);
}

// The dev TUI binary has no embedded engine — it runs the engine from source (npx tsx). Point it at
// the BiMax install so that resolves no matter which directory `bimax` was launched from. (A release
// build embeds the engine and ignores this.)
const env = { ...process.env };
if (!env.BIMAX_REPO_ROOT) env.BIMAX_REPO_ROOT = pkgRoot;

const r = spawnSync(tui, args, { stdio: 'inherit', env });
if (r.error) {
  console.error('Failed to launch BiMax TUI:', r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 0);
