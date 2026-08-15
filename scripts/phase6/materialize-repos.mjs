#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [terminalArg, desktopArg, sourceCommit, snapshotCommit] = process.argv.slice(2);
if (!terminalArg || !desktopArg || !sourceCommit || !snapshotCommit) {
  throw new Error('usage: materialize-repos.mjs <terminal-repo> <desktop-repo> <source-commit> <snapshot-commit>');
}

const terminal = path.resolve(terminalArg);
const desktop = path.resolve(desktopArg);
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

async function removeAll(root, entries) {
  await Promise.all(entries.map((entry) => rm(path.join(root, entry), { recursive: true, force: true })));
}

const terminalPackage = await readJson(path.join(terminal, 'package.json'));
terminalPackage.name = 'bimax-terminal';
for (const script of [
  'app:dev', 'app:dist:mac', 'gen:app-protocol', 'check:protocol-mirror',
  'verify:desktop-package', 'phase1:check', 'phase2:check', 'phase3:check',
  'phase4:check', 'phase5:check',
]) delete terminalPackage.scripts[script];
terminalPackage.scripts['ci:check'] = 'npm run build && npm run test:ci';
await writeJson(path.join(terminal, 'package.json'), terminalPackage);

await removeAll(terminal, [
  'BUG_AUDIT.md', 'CHATGPT_COMPUTER_USE_TEARDOWN.md', 'CLAUDE_BACKEND_HANDOFF.md',
  'COMPUTER_USE_HANDOFF_LOG.md', 'COMPUTER_USE_RESEARCH.md', 'probe-ax.ts',
  'benchmarks/cu-baseline',
  'scripts/check-protocol-mirror.mjs', 'scripts/gen-app-protocol.mjs',
  'scripts/verify-desktop-package.mjs', 'scripts/phase1-local-gate.sh',
  'scripts/phase3-local-gate.sh', 'scripts/phase4-local-gate.sh',
  'scripts/phase5-local-gate.sh', 'scripts/phase6-local-gate.sh', 'scripts/phase6',
  'src/__tests__/desktop.bundle.resolution.test.ts',
  'src/__tests__/desktop.runtime.security.test.ts',
  'src/__tests__/desktop.supervisor.test.ts',
  'src/__tests__/desktop.trust.report.test.ts',
  'src/__tests__/phase1.packaging.boundary.test.ts',
  'src/__tests__/phase3.engine.boundary.test.ts',
  'src/__tests__/phase5.renderer.models.test.ts',
  'src/__tests__/phase5.takeover.authority.test.ts',
  'src/__tests__/receipt.inspector.test.ts',
  'src/__tests__/trust.center.model.test.ts',
]);

await writeFile(path.join(terminal, 'AGENTS.md'), `# Bimax Terminal repository instructions

Bimax Terminal is the coding product. It owns the coding engine, protocol, tools, sessions, review
and Go terminal frontend. It must never acquire macOS Computer Use binaries, permissions, prompts,
provider policy, native services or fallback ownership.

Desktop consumes only versioned engine and protocol release artifacts. Changes to the protocol or
engine release manifest must keep current and previous supported protocol fixtures passing.
`);

await mkdir(path.join(terminal, '.github', 'workflows'), { recursive: true });
await writeFile(path.join(terminal, '.github', 'workflows', 'ci.yml'), `name: Terminal CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  engine:
    runs-on: ubuntu-22.04
    env:
      PUPPETEER_SKIP_DOWNLOAD: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: sudo apt-get update && sudo apt-get install -y bubblewrap
      - run: npm ci
      - run: npm run build
      - run: npm run lint
      - run: npm run gen:protocol
      - run: git diff --exit-code -- src/protocol
      - run: npm run test:ci

  tui:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: tui/go.sum
      - run: npm ci
      - run: npm run build
      - run: go build ./...
        working-directory: tui
      - run: go vet ./...
        working-directory: tui
      - run: go test ./...
        working-directory: tui
`);

await writeJson(path.join(terminal, 'repo-boundary.json'), {
  schemaVersion: 1,
  product: 'bimax-terminal',
  sourceCommit,
  snapshotCommit,
  owns: ['coding-engine', 'client-protocol-source', 'go-terminal'],
  forbids: ['computer-use', 'accessibility-permission', 'screen-recording-permission', 'native-mac-provider'],
});

const desktopPackage = await readJson(path.join(desktop, 'package.json'));
desktopPackage.name = 'bimax-desktop';
desktopPackage.scripts['verify:provider'] = 'node scripts/verify-mac-provider.mjs';
desktopPackage.scripts['verify:package'] = 'node scripts/verify-desktop-package.mjs';
desktopPackage.scripts['ci:check'] = 'npm run typecheck && npm run build && npm run test:mac:unit -- --runInBand';
await writeJson(path.join(desktop, 'package.json'), desktopPackage);

await writeFile(path.join(desktop, 'AGENTS.md'), `# Bimax Desktop repository instructions

Bimax Desktop is the sole macOS Computer Use and permission owner. It owns Electron, the sandboxed
renderer, the Mac capability provider, native Swift/XPC services, Trust Center, action receipts and
Computer Use evaluations. It consumes a pinned, digest-verified Bimax Terminal engine artifact and
must never copy or compile Terminal engine source.

Before product or architecture changes, read docs/product-reset/README.md and the applicable
product-reset documents. Preserve the status vocabulary Implemented, Measured, Product-ready,
Target and Win, and grade end state rather than tool invocation.
`);

await mkdir(path.join(desktop, '.github', 'workflows'), { recursive: true });
await writeFile(path.join(desktop, '.github', 'workflows', 'ci.yml'), `name: Desktop CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  desktop:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: npm ci
      - run: npm run ci:check
      - run: swift build --package-path native/BimaxComputerUseKit --product bimax-cu-service
      - run: swift build --package-path native/BimaxComputerUseKit --product bimax-cu-bridge
      - run: bun build --compile --target=bun-darwin-arm64 src/capabilities/mac/provider.entry.ts --outfile /tmp/bimax-mac-capability
      - run: node scripts/verify-mac-provider.mjs /tmp/bimax-mac-capability
`);

await writeJson(path.join(desktop, 'repo-boundary.json'), {
  schemaVersion: 1,
  product: 'bimax-desktop',
  sourceCommit,
  snapshotCommit,
  owns: ['electron-desktop', 'mac-capability-provider', 'native-xpc-service', 'computer-use-evaluations'],
  consumes: ['pinned-engine-release', 'versioned-client-protocol'],
  forbids: ['terminal-engine-source', 'terminal-release-binary'],
});
