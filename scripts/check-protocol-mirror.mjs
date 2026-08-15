#!/usr/bin/env node
// check-protocol-mirror.mjs — CI gate for the desktop app's copy of the engine wire contract.
//
// Phase 1 of the consolidation plan retired the hand-written mirror: app/src/renderer/src/
// protocol.gen.ts is now GENERATED verbatim from src/protocol/protocol.ts (see
// scripts/gen-app-protocol.mjs), and protocol.ts re-exports it. So the check is no longer a
// fuzzy version+tag comparison — it's an exact regenerate-and-diff: if the committed generated
// file isn't byte-identical to what the generator would emit today, the engine protocol changed
// without `npm run gen:app-protocol` being run, and CI fails.
import { readFileSync } from 'node:fs';
import { generate, generateCompatibility, generateEvidence } from './gen-app-protocol.mjs';

const OUT = new URL('../app/src/renderer/src/protocol.gen.ts', import.meta.url);
const COMPAT_OUT = new URL('../app/src/shared/protocol.compat.gen.ts', import.meta.url);
const EVIDENCE_OUT = new URL('../app/src/shared/evidence.gen.ts', import.meta.url);

let committed;
try {
  committed = readFileSync(OUT, 'utf8');
} catch {
  console.error('protocol mirror missing: app/src/renderer/src/protocol.gen.ts');
  console.error('run `npm run gen:app-protocol` and commit the result.');
  process.exit(1);
}

const expected = generate();
if (committed !== expected) {
  console.error('protocol mirror drift — app/src/renderer/src/protocol.gen.ts is stale.');
  console.error('the engine protocol (src/protocol/protocol.ts) changed but the generated app');
  console.error('mirror was not regenerated. run `npm run gen:app-protocol` and commit the file.');
  process.exit(1);
}

let committedCompatibility;
try {
  committedCompatibility = readFileSync(COMPAT_OUT, 'utf8');
} catch {
  console.error('protocol compatibility module missing: app/src/shared/protocol.compat.gen.ts');
  process.exit(1);
}
if (committedCompatibility !== generateCompatibility()) {
  console.error('protocol compatibility module drift — run `npm run gen:app-protocol`.');
  process.exit(1);
}

let committedEvidence;
try {
  committedEvidence = readFileSync(EVIDENCE_OUT, 'utf8');
} catch {
  console.error('evidence mirror missing: app/src/shared/evidence.gen.ts');
  console.error('run `npm run gen:app-protocol` and commit the result.');
  process.exit(1);
}
const expectedEvidence = generateEvidence();
if (committedEvidence !== expectedEvidence) {
  console.error('evidence mirror drift — app/src/shared/evidence.gen.ts is stale.');
  console.error('the shared causal evidence vocabulary (src/evidence/schema.ts) changed but the');
  console.error('generated Desktop mirror was not regenerated. run `npm run gen:app-protocol`.');
  process.exit(1);
}

const version = expected.match(/PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1] ?? '?';
const tags = new Set([...expected.matchAll(/\bt:\s*'([A-Za-z_]+)'/g)].map((m) => m[1]));
const evidenceSchema = expectedEvidence.match(/EVIDENCE_SCHEMA = '([^']+)'/)?.[1] ?? '?';
const ruleCount = (expectedEvidence.match(/: '(BMX-[A-FX]-[A-Z-]+)'/g) ?? []).length;
console.log(`protocol mirror in sync: v${version}, ${tags.size} message tags, generated file byte-identical`);
console.log(`evidence mirror in sync: ${evidenceSchema}, ${ruleCount} registered rule ids, byte-identical`);
