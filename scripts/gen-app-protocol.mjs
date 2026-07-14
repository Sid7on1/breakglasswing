#!/usr/bin/env node
// gen-app-protocol.mjs — the desktop app's renderer needs the engine wire contract, but it can't
// import from src/protocol (that's the engine's TS project, a separate build). Phase 1 of the
// consolidation plan retires the hand-copied mirror: the wire half is now GENERATED verbatim from
// src/protocol/protocol.ts into app/src/renderer/src/protocol.gen.ts, and app/.../protocol.ts
// re-exports it and adds only the renderer-only payload shapes (ToolCallEntry, UiSnapshot, …).
//
// Run directly to (re)write the generated file:   npm run gen:app-protocol
// The CI gate imports generate() and fails if the committed file is stale (scripts/check-protocol-mirror.mjs).
import { readFileSync, writeFileSync } from 'node:fs';

const ENGINE = new URL('../src/protocol/protocol.ts', import.meta.url);
const OUT = new URL('../app/src/renderer/src/protocol.gen.ts', import.meta.url);

const BANNER = `// ⚠️  GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: src/protocol/protocol.ts (the engine↔front-end wire contract).
// Regenerate:  npm run gen:app-protocol      CI gate:  npm run check:protocol-mirror
// Renderer-only payload shapes (ui_snapshot / event payloads) live in ./protocol.ts,
// which re-exports everything below and layers those on top.
`;

/** The generated file's exact contents, given the engine protocol source. Pure — no I/O. */
export function generate(engineSrc = readFileSync(ENGINE, 'utf8')) {
  return `${BANNER}\n${engineSrc.replace(/\s+$/, '')}\n`;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  writeFileSync(OUT, generate(), 'utf8');
  console.log('wrote app/src/renderer/src/protocol.gen.ts from src/protocol/protocol.ts');
}
