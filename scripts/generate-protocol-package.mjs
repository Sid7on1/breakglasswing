#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolSource = readFileSync(path.join(root, 'src/protocol/protocol.ts'), 'utf8');
const fixturesPath = path.join(root, 'src/protocol/schema/fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
const semver = protocolSource.match(/PROTOCOL_SEMVER\s*=\s*'([^']+)'/)?.[1];
if (!semver) throw new Error('PROTOCOL_SEMVER missing from src/protocol/protocol.ts');

const required = {
  event: ['t', 'name', 'args'], request: ['t', 'id', 'kind', 'question', 'options'],
  ready: ['t', 'protocol'], hello: ['t', 'engine', 'protocolVersion', 'protocolMajor', 'minCompatibleMajor', 'maxCompatibleMajor', 'features'],
  queryResult: ['t', 'id', 'items'], pong: ['t', 'id'], configResult: ['t', 'id', 'config'],
  boot: ['t', 'phase', 'pid'], health: ['t', 'uptimeMs', 'rssMb', 'heapMb', 'eventLoopDelayMs', 'activeTurn', 'phase'],
  reply: ['t', 'id', 'value'], input: ['t', 'text'], interrupt: ['t'], query: ['t', 'id', 'text'],
  menuSelect: ['t', 'id', 'value'], ping: ['t', 'id'], configGet: ['t', 'id'], configSet: ['t', 'id', 'patch'],
  resume: ['t', 'id'], controls: ['t'],
};

function infer(value, key = '') {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? infer(value[0]) : {} };
  if (typeof value === 'object') {
    const properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, infer(v, k)]));
    const schema = { type: 'object', properties, additionalProperties: true };
    if (key === 'engine') schema.required = ['version', 'buildCommit'];
    return schema;
  }
  if (key === 't' || key === 'kind' || key === 'phase') return { type: typeof value, const: value };
  return { type: typeof value === 'number' ? 'number' : typeof value };
}

function variant(message) {
  const schema = infer(message);
  schema.required = required[message.t] || ['t'];
  return schema;
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://bimax.dev/protocol/${semver}/ndjson-message.schema.json`,
  title: `Bimax client NDJSON protocol ${semver}`,
  description: 'One decoded NDJSON frame. Unknown additive properties remain allowed within a compatible major.',
  anyOf: [...fixtures.outbound, ...fixtures.inbound].map(variant),
};

const schemaPath = path.join(root, 'src/protocol/schema/protocol.schema.json');
writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');

const out = path.join(root, 'build/protocol', `bimax-client-protocol-v${semver}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'golden'), { recursive: true });
writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: '@bimax/client-protocol', version: semver, private: false,
  files: ['protocol.ts', 'protocol.schema.json', 'fixtures.json', 'golden/'],
}, null, 2) + '\n');
cpSync(path.join(root, 'src/protocol/protocol.ts'), path.join(out, 'protocol.ts'));
cpSync(schemaPath, path.join(out, 'protocol.schema.json'));
cpSync(fixturesPath, path.join(out, 'fixtures.json'));
cpSync(path.join(root, 'src/protocol/schema/golden'), path.join(out, 'golden'), { recursive: true });

const files = ['package.json', 'protocol.ts', 'protocol.schema.json', 'fixtures.json'];
const hashes = Object.fromEntries(files.map((file) => [file, createHash('sha256').update(readFileSync(path.join(out, file))).digest('hex')]));
writeFileSync(path.join(out, 'SHA256SUMS.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`protocol package ready: ${path.relative(root, out)} (${semver})`);
