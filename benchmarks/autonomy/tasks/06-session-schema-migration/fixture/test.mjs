import assert from 'node:assert/strict';
import { migrateSession, summarizeSessions } from './src/index.mjs';

const source = {
  version: 1,
  id: 's-1',
  user: 'u-1',
  startedAt: '2026-01-01T00:00:00Z',
  turns: [{ role: 'user', text: 'hello' }],
  metadata: { color: 'blue' },
};
const migrated = migrateSession(structuredClone(source));
assert.equal(migrated.version, 2);
assert.deepEqual(migrated.owner, { id: 'u-1' });
assert.deepEqual(migrated.messages, [{ role: 'user', content: 'hello' }]);
assert.deepEqual(migrateSession(Object.freeze(structuredClone(source))).metadata, { color: 'blue' });
assert.deepEqual(summarizeSessions([structuredClone(source)]), [{
  id: 's-1', ownerId: 'u-1', createdAt: '2026-01-01T00:00:00Z', messageCount: 1,
}]);
console.log('fixture tests passed');
