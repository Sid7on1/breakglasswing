import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'decoder.mjs')).href}?check=${Date.now()}`;
const { createRecordDecoder } = await import(moduleUrl);

const values = [
  { id: 7, label: 'café' },
  { id: 8, label: '東京', nested: { ok: true } },
  ['snow', '☃'],
];
const payload = Buffer.from(`${JSON.stringify(values[0])}\r\n\r\n${JSON.stringify(values[1])}\n${JSON.stringify(values[2])}`);

function decodeWithCuts(cuts) {
  const decoder = createRecordDecoder();
  const output = [];
  let offset = 0;
  for (const size of cuts) {
    if (offset >= payload.length) break;
    const source = Buffer.from(payload.subarray(offset, Math.min(payload.length, offset + size)));
    const snapshot = Buffer.from(source);
    output.push(...decoder.push(source));
    assert.deepEqual(source, snapshot, 'push must not mutate its byte chunk');
    offset += size;
  }
  if (offset < payload.length) output.push(...decoder.push(payload.subarray(offset)));
  output.push(...decoder.flush());
  assert.deepEqual(decoder.flush(), []);
  return output;
}

assert.deepEqual(decodeWithCuts([1, 2, 3, 1, 4, 2, 1, 5, 1, 1, 2, 7]), values);
assert.deepEqual(decodeWithCuts([17, 1, 1, 9, 2, 23]), values);
assert.deepEqual(decodeWithCuts([payload.length]), values);

const invalid = createRecordDecoder();
invalid.push(Buffer.from('{}\r'));
assert.throws(() => invalid.push(Buffer.from('\n\n{"bad":}\n')), /Invalid JSON on line 3:/);

const trailing = createRecordDecoder();
const unicode = Buffer.from('{"emoji":"🧭"}');
trailing.push(unicode.subarray(0, unicode.length - 2));
assert.deepEqual(trailing.push(unicode.subarray(unicode.length - 2)), []);
assert.deepEqual(trailing.flush(), [{ emoji: '🧭' }]);

console.log('success check passed');
