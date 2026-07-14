import assert from 'node:assert/strict';
import { runSchedule } from './src/scheduler.mjs';

const graph = [
  { id: 'compile', deps: [] },
  { id: 'lint', deps: [] },
  { id: 'package', deps: ['compile', 'lint'] },
];
const finished = new Set();
const values = await runSchedule(graph, {
  limit: 2,
  run: async node => {
    for (const dependency of node.deps) assert.equal(finished.has(dependency), true);
    await new Promise(resolve => setTimeout(resolve, node.id === 'compile' ? 5 : 1));
    finished.add(node.id);
    return node.id.toUpperCase();
  },
});
assert.deepEqual(values, ['COMPILE', 'LINT', 'PACKAGE']);
console.log('fixture tests passed');
