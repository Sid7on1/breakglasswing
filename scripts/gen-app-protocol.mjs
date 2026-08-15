#!/usr/bin/env node
// gen-app-protocol.mjs — the desktop app's renderer needs the engine wire contract, but it can't
// import from src/protocol (that's the engine's TS project, a separate build). Phase 1 of the
// consolidation plan retires the hand-copied mirror: the wire half is now GENERATED verbatim from
// src/protocol/protocol.ts into app/src/renderer/src/protocol.gen.ts, and app/.../protocol.ts
// re-exports it and adds only the renderer-only payload shapes (ToolCallEntry, UiSnapshot, …).
//
// Run directly to (re)write the generated file:   npm run gen:app-protocol
// The CI gate imports generate() and fails if the committed file is stale (scripts/check-protocol-mirror.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ENGINE = new URL('../src/protocol/protocol.ts', import.meta.url);
const OUT = new URL('../app/src/renderer/src/protocol.gen.ts', import.meta.url);
const COMPAT_OUT = new URL('../app/src/shared/protocol.compat.gen.ts', import.meta.url);
// Phase 8 (owner sections 28/29): the causal evidence vocabulary is the second thing both products
// must agree on byte-for-byte. Same mechanism, same drift gate — Desktop's broker and Trust Center
// must not be able to disagree with the engine about what a Verification or a Decision means.
const EVIDENCE = new URL('../src/evidence/schema.ts', import.meta.url);
const EVIDENCE_OUT = new URL('../app/src/shared/evidence.gen.ts', import.meta.url);

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

const EVIDENCE_BANNER = `// ⚠️  GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: src/evidence/schema.ts (the shared causal evidence vocabulary, owner
// sections 28/29 — docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §2.2).
// Regenerate:  npm run gen:app-protocol      CI gate:  npm run check:protocol-mirror
// The engine ledger (src/evidence/ledger.ts) is deliberately NOT mirrored: the vocabulary is
// shared, the store is not. Desktop owns its own bounded, user-deletable evidence store.
`;

/** The generated evidence mirror's exact contents. Pure — no I/O. */
export function generateEvidence(evidenceSrc = readFileSync(EVIDENCE, 'utf8')) {
  return `${EVIDENCE_BANNER}\n${evidenceSrc.replace(/\s+$/, '')}\n`;
}

function constant(engineSrc, name) {
  const match = engineSrc.match(new RegExp(`export const ${name}\\s*=\\s*(['\"]?)([^;'\"\\n]+)\\1`));
  if (!match) throw new Error(`missing protocol constant ${name}`);
  return match[2].trim();
}

/** Small generated module safe for Electron main and renderer imports. */
export function generateCompatibility(engineSrc = readFileSync(ENGINE, 'utf8')) {
  const semver = constant(engineSrc, 'PROTOCOL_SEMVER');
  const min = constant(engineSrc, 'PROTOCOL_MIN_COMPATIBLE_MAJOR');
  const max = constant(engineSrc, 'PROTOCOL_MAX_COMPATIBLE_MAJOR');
  return `// ⚠️  GENERATED FILE — DO NOT EDIT BY HAND.\n` +
    `// Source: src/protocol/protocol.ts · Regenerate: npm run gen:app-protocol\n` +
    `export const CLIENT_PROTOCOL_VERSION = '${semver}';\n` +
    `export const CLIENT_MIN_COMPATIBLE_MAJOR = ${min};\n` +
    `export const CLIENT_MAX_COMPATIBLE_MAJOR = ${max};\n\n` +
    `export function supportsProtocolMajor(major: number): boolean {\n` +
    `  return Number.isInteger(major) && major >= CLIENT_MIN_COMPATIBLE_MAJOR && major <= CLIENT_MAX_COMPATIBLE_MAJOR;\n` +
    `}\n`;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  writeFileSync(OUT, generate(), 'utf8');
  mkdirSync(new URL('../app/src/shared/', import.meta.url), { recursive: true });
  writeFileSync(COMPAT_OUT, generateCompatibility(), 'utf8');
  writeFileSync(EVIDENCE_OUT, generateEvidence(), 'utf8');
  console.log('wrote app/src/renderer/src/protocol.gen.ts from src/protocol/protocol.ts');
  console.log('wrote app/src/shared/protocol.compat.gen.ts from protocol compatibility constants');
  console.log('wrote app/src/shared/evidence.gen.ts from src/evidence/schema.ts');
}
