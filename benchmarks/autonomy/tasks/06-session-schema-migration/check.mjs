import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'index.mjs')).href}?check=${Date.now()}`;
const { migrateSession, readSession, writeSession, summarizeSessions } = await import(moduleUrl);
const root = await mkdtemp(path.join(os.tmpdir(), 'bimax-session-check-'));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const v1 = deepFreeze({
  version: 1,
  id: 'hidden-b',
  user: 'owner-9',
  startedAt: '2026-05-02T10:00:00.000Z',
  turns: [
    { role: 'user', text: 'alpha', traceId: 't-1' },
    { role: 'assistant', text: 'beta', latencyMs: 17 },
  ],
  metadata: { labels: ['private', 'migration'], nested: { score: 4 } },
  retention: { days: 30 },
});

const migrated = migrateSession(v1);
assert.deepEqual(migrated, {
  version: 2,
  id: 'hidden-b',
  metadata: { labels: ['private', 'migration'], nested: { score: 4 } },
  retention: { days: 30 },
  owner: { id: 'owner-9' },
  createdAt: '2026-05-02T10:00:00.000Z',
  messages: [
    { role: 'user', content: 'alpha', traceId: 't-1' },
    { role: 'assistant', content: 'beta', latencyMs: 17 },
  ],
});
assert.deepEqual(v1.metadata.nested, { score: 4 });

const frozenV2 = deepFreeze(structuredClone(migrated));
assert.deepEqual(migrateSession(frozenV2), migrated, 'v2 migration must be idempotent');

const oldFile = path.join(root, 'old.json');
const newFile = path.join(root, 'new.json');
await writeFile(oldFile, JSON.stringify(v1), 'utf8');
assert.deepEqual(await readSession(oldFile), migrated);
assert.deepEqual(await writeSession(newFile, v1), migrated);
assert.equal((await readFile(newFile, 'utf8')).endsWith('\n'), true);
assert.deepEqual(await readSession(newFile), migrated);

const early = deepFreeze({
  version: 2, id: 'a', owner: { id: 'u-a' }, createdAt: '2026-01-01T00:00:00Z', messages: [],
});
const sameTime = deepFreeze({
  version: 2, id: 'z', owner: { id: 'u-z' }, createdAt: '2026-01-01T00:00:00Z', messages: [{ role: 'user', content: 'x' }],
});
const records = deepFreeze([v1, sameTime, early]);
assert.deepEqual(summarizeSessions(records), [
  { id: 'a', ownerId: 'u-a', createdAt: '2026-01-01T00:00:00Z', messageCount: 0 },
  { id: 'z', ownerId: 'u-z', createdAt: '2026-01-01T00:00:00Z', messageCount: 1 },
  { id: 'hidden-b', ownerId: 'owner-9', createdAt: '2026-05-02T10:00:00.000Z', messageCount: 2 },
]);

const malformed = path.join(root, 'malformed.json');
await writeFile(malformed, '{broken', 'utf8');
await assert.rejects(readSession(malformed), /^Error: Invalid session record:/);
assert.throws(() => migrateSession({ version: 7 }), /^Error: Invalid session record:/);

console.log('success check passed');
