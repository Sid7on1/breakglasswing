import assert from 'node:assert/strict';
import { createRetryCache } from './src/retry-cache.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let now = 10;
const alphaGate = deferred();
let alphaLoads = 0;
const cache = createRetryCache({
  ttlMs: 10,
  now: () => now,
  loader: key => {
    alphaLoads += 1;
    return alphaGate.promise.then(value => `${key}:${value}`);
  },
});

const alphaOne = cache.get('alpha');
now = 30;
const alphaTwo = cache.get('alpha');
await Promise.resolve();
assert.equal(alphaLoads, 1, 'pending calls for one key share one loader');
alphaGate.resolve('ready');
assert.deepEqual(await Promise.all([alphaOne, alphaTwo]), ['alpha:ready', 'alpha:ready']);

let flakyLoads = 0;
const flakyCache = createRetryCache({
  ttlMs: 100,
  now: () => 0,
  loader: async () => {
    flakyLoads += 1;
    if (flakyLoads === 1) throw new Error('temporary');
    return 'recovered';
  },
});
await assert.rejects(flakyCache.get('flaky'), /temporary/);
assert.equal(await flakyCache.get('flaky'), 'recovered');

now = 100;
let timedLoads = 0;
const timedGate = deferred();
const timedCache = createRetryCache({
  ttlMs: 20,
  now: () => now,
  loader: () => {
    timedLoads += 1;
    return timedLoads === 1 ? timedGate.promise : Promise.resolve(`value-${timedLoads}`);
  },
});
const first = timedCache.get('timed');
await Promise.resolve();
now = 150;
timedGate.resolve('value-1');
assert.equal(await first, 'value-1');
now = 169;
assert.equal(await timedCache.get('timed'), 'value-1');
now = 170;
assert.equal(await timedCache.get('timed'), 'value-2');
console.log('fixture tests passed');
