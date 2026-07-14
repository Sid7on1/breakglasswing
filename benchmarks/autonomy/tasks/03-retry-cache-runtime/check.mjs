import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'retry-cache.mjs')).href}?check=${Date.now()}`;
const { createRetryCache } = await import(moduleUrl);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Concurrent identical keys must share work even when time advances while the load is pending.
let clock = 100;
const amberGate = deferred();
const amberCalls = [];
const amberOptions = deepFreeze({ trace: { id: 'hidden-17' }, priority: 3 });
const concurrentCache = createRetryCache({
  ttlMs: 25,
  now: () => clock,
  loader: (key, options) => {
    amberCalls.push({ key, options });
    return amberGate.promise;
  },
});
const amberFirst = concurrentCache.get('amber', amberOptions);
clock = 10_000;
const amberSecond = concurrentCache.get('amber', amberOptions);
await Promise.resolve();
assert.equal(amberCalls.length, 1, 'concurrent identical keys must invoke the loader once');
assert.equal(amberCalls[0].key, 'amber');
assert.equal(amberCalls[0].options, amberOptions, 'the exact options object must reach the loader');
amberGate.resolve({ code: 73 });
assert.deepEqual(await Promise.all([amberFirst, amberSecond]), [{ code: 73 }, { code: 73 }]);
assert.deepEqual(amberOptions, { trace: { id: 'hidden-17' }, priority: 3 });

// Different keys must begin independently rather than serializing behind one pending load.
const gates = new Map([['cobalt', deferred()], ['ivory', deferred()]]);
const started = [];
const independentCache = createRetryCache({
  ttlMs: 100,
  now: () => 0,
  loader: key => {
    started.push(key);
    return gates.get(key).promise;
  },
});
const cobalt = independentCache.get('cobalt');
const ivory = independentCache.get('ivory');
await Promise.resolve();
assert.deepEqual(started.sort(), ['cobalt', 'ivory']);
gates.get('cobalt').resolve('C');
gates.get('ivory').resolve('I');
assert.deepEqual(await Promise.all([cobalt, ivory]), ['C', 'I']);

// A rejected entry must leave no poison behind for the next caller.
let retryAttempts = 0;
const retryCache = createRetryCache({
  ttlMs: 1000,
  now: () => 50,
  loader: async key => {
    retryAttempts += 1;
    if (retryAttempts === 1) throw new Error(`temporary:${key}`);
    return `recovered:${key}`;
  },
});
await assert.rejects(retryCache.get('violet'), /temporary:violet/);
assert.equal(await retryCache.get('violet'), 'recovered:violet');
assert.equal(retryAttempts, 2);

// TTL starts when the deferred load resolves, and the exact boundary is expired.
clock = 500;
let ttlLoads = 0;
const firstTtlGate = deferred();
const ttlCache = createRetryCache({
  ttlMs: 50,
  now: () => clock,
  loader: () => {
    ttlLoads += 1;
    return ttlLoads === 1 ? firstTtlGate.promise : Promise.resolve(`ttl-value-${ttlLoads}`);
  },
});
const firstTtlValue = ttlCache.get('silver');
await Promise.resolve();
clock = 700;
firstTtlGate.resolve('ttl-value-1');
assert.equal(await firstTtlValue, 'ttl-value-1');
clock = 749;
assert.equal(await ttlCache.get('silver'), 'ttl-value-1');
assert.equal(ttlLoads, 1);
clock = 750;
assert.equal(await ttlCache.get('silver'), 'ttl-value-2');
assert.equal(ttlLoads, 2);

console.log('success check passed');
