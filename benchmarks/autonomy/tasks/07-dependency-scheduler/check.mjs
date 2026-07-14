import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'scheduler.mjs')).href}?check=${Date.now()}`;
const { runSchedule } = await import(moduleUrl);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const graph = deepFreeze([
  { id: 'a', deps: [] },
  { id: 'b', deps: [] },
  { id: 'c', deps: ['a'] },
  { id: 'd', deps: ['a', 'b'] },
  { id: 'e', deps: ['c', 'd'] },
]);
let active = 0;
let peak = 0;
const completed = new Set();
const starts = [];
const delays = { a: 18, b: 4, c: 2, d: 9, e: 1 };
const result = await runSchedule(graph, {
  limit: 2,
  run: async node => {
    for (const dependency of node.deps) {
      assert.equal(completed.has(dependency), true, `${node.id} started before ${dependency}`);
    }
    starts.push(node.id);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delays[node.id]));
    active -= 1;
    completed.add(node.id);
    return `value:${node.id}`;
  },
});
assert.deepEqual(result, ['value:a', 'value:b', 'value:c', 'value:d', 'value:e']);
assert.equal(peak, 2);
assert.equal(starts.indexOf('c') > starts.indexOf('a'), true);
assert.equal(starts.indexOf('e') > starts.indexOf('d'), true);

let validationRuns = 0;
await assert.rejects(
  runSchedule([{ id: 'x', deps: ['missing'] }], { limit: 1, run: async () => { validationRuns += 1; } }),
  /Missing dependency/,
);
await assert.rejects(
  runSchedule([{ id: 'x', deps: ['y'] }, { id: 'y', deps: ['x'] }], { limit: 2, run: async () => { validationRuns += 1; } }),
  /Dependency cycle detected/,
);
await assert.rejects(
  runSchedule([{ id: 'x', deps: [] }, { id: 'x', deps: [] }], { limit: 2, run: async () => { validationRuns += 1; } }),
  /Duplicate node/,
);
assert.equal(validationRuns, 0, 'invalid graphs must fail before running jobs');
await assert.rejects(runSchedule([], { limit: 0, run: async () => {} }), /positive integer/);

let launched = 0;
await assert.rejects(
  runSchedule([
    { id: 'root', deps: [] },
    { id: 'after', deps: ['root'] },
  ], {
    limit: 1,
    run: async node => {
      launched += 1;
      if (node.id === 'root') throw new Error('job exploded');
      return node.id;
    },
  }),
  /job exploded/,
);
assert.equal(launched, 1);
assert.deepEqual(graph.map(node => ({ id: node.id, deps: [...node.deps] })), [
  { id: 'a', deps: [] }, { id: 'b', deps: [] }, { id: 'c', deps: ['a'] },
  { id: 'd', deps: ['a', 'b'] }, { id: 'e', deps: ['c', 'd'] },
]);

console.log('success check passed');
