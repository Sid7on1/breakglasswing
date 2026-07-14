import assert from 'node:assert/strict';
import { normalizeRoutePath } from './src/path-utils.mjs';
import { routeFile } from './src/router.mjs';

const routes = [
  { extension: '.test.ts', handler: 'test' },
  { extension: '.ts', handler: 'typescript' },
];

assert.equal(normalizeRoutePath('/repo//SRC/thing.TS?raw=1'), '/repo/src/thing.ts');
assert.equal(normalizeRoutePath('C:\\repo\\src\\thing.TS'), 'c:/repo/src/thing.ts');
assert.equal(routeFile('/repo/src/thing.test.ts#L4', routes), 'test');
assert.equal(routeFile('/repo/src/thing.ts', routes), 'typescript');
assert.equal(routeFile('/repo/src/readme.md', routes), null);
assert.throws(() => normalizeRoutePath(''), /path must be a non-empty string/);
console.log('fixture tests passed');
