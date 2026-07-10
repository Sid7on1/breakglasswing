#!/usr/bin/env node
// check-protocol-mirror.mjs — the desktop app keeps a hand-written mirror of the engine's wire
// contract (app/src/renderer/src/protocol.ts ← src/protocol/protocol.ts). The engine↔Go-TUI pair
// is covered by generated fixtures + contract tests; this gate is the equivalent for the app:
// CI fails the moment the mirror's version or message vocabulary drifts from the engine's.
//
// Checks (engine is the source of truth; the mirror may be a superset — it also carries
// renderer-only payload shapes):
//   1. PROTOCOL_VERSION must be identical.
//   2. Every wire message tag (`t: '...'`) in the engine file must appear in the mirror.
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const ENGINE = 'src/protocol/protocol.ts';
const MIRROR = 'app/src/renderer/src/protocol.ts';
const engine = read(ENGINE);
const mirror = read(MIRROR);

const version = (src, name) => {
  const m = src.match(/PROTOCOL_VERSION\s*=\s*(\d+)/);
  if (!m) { console.error(`${name}: PROTOCOL_VERSION not found`); process.exit(1); }
  return Number(m[1]);
};

// Wire message tags as written in the interfaces: `t: 'event';` etc.
const tags = (src) => new Set([...src.matchAll(/\bt:\s*'([A-Za-z_]+)'/g)].map((m) => m[1]));

const errors = [];
const ev = version(engine, ENGINE);
const mv = version(mirror, MIRROR);
if (ev !== mv) errors.push(`PROTOCOL_VERSION mismatch: engine=v${ev}, app mirror=v${mv}`);

const engineTags = tags(engine);
for (const t of engineTags) {
  if (!tags(mirror).has(t)) errors.push(`message tag '${t}' exists in the engine protocol but is missing from the app mirror`);
}

if (errors.length) {
  console.error(`protocol mirror drift — ${MIRROR} no longer matches ${ENGINE}:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('update the mirror (and its version-history comment) in the same change as the engine protocol.');
  process.exit(1);
}
console.log(`protocol mirror in sync: v${ev}, ${engineTags.size} message tags covered`);
