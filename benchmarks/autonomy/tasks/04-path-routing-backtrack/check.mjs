import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stamp = Date.now();
const base = pathToFileURL(path.join(process.cwd(), 'src')).href;
const { normalizeRoutePath } = await import(`${base}/path-utils.mjs?check=${stamp}`);
const { routeFile } = await import(`${base}/router.mjs?check=${stamp}`);

assert.equal(
  normalizeRoutePath('C:\\Work\\Client\\SRC\\Widget.TEST.TS?loader=raw#ignored'),
  'c:/work/client/src/widget.test.ts',
);
assert.equal(normalizeRoutePath('\\\\server\\share\\\\lib\\mod.JS#L20'), '/server/share/lib/mod.js');
assert.throws(() => normalizeRoutePath(null), {
  name: 'TypeError',
  message: 'path must be a non-empty string',
});

const routes = Object.freeze([
  Object.freeze({ extension: '.TS', handler: Object.freeze({ name: 'broad-first' }) }),
  Object.freeze({ extension: '.test.ts', handler: Object.freeze({ name: 'compound-later' }) }),
]);
assert.equal(routeFile('D:\\repo\\unit\\widget.test.ts?run=1', routes), routes[0].handler);

const compoundFirst = Object.freeze([
  Object.freeze({ extension: '.spec.jsx', handler: 'spec' }),
  Object.freeze({ extension: '.jsx', handler: 'jsx' }),
]);
assert.equal(routeFile('/A//B/Panel.SPEC.JSX#case', compoundFirst), 'spec');
assert.equal(routeFile('/A/B/Panel.JSX', compoundFirst), 'jsx');
assert.equal(routeFile('/A/B/Panel.JSX.map', compoundFirst), null);
assert.deepEqual(routes.map(item => ({ extension: item.extension, handler: item.handler.name })), [
  { extension: '.TS', handler: 'broad-first' },
  { extension: '.test.ts', handler: 'compound-later' },
]);

console.log('success check passed');
