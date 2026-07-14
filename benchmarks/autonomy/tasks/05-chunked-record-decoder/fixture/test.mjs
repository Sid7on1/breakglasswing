import assert from 'node:assert/strict';
import { createRecordDecoder } from './src/decoder.mjs';

const decoder = createRecordDecoder();
assert.deepEqual(decoder.push(Buffer.from('{"a":1}\n{"b"')), [{ a: 1 }]);
assert.deepEqual(decoder.push(Buffer.from(':2}\n')), [{ b: 2 }]);
assert.deepEqual(decoder.flush(), []);
assert.deepEqual(decoder.flush(), []);

const unicode = createRecordDecoder();
const encoded = Buffer.from('{"label":"🧭"}\n');
assert.deepEqual(unicode.push(encoded.subarray(0, encoded.length - 3)), []);
assert.deepEqual(unicode.push(encoded.subarray(encoded.length - 3)), [{ label: '🧭' }]);

const invalid = createRecordDecoder();
invalid.push(Buffer.from('\n'));
assert.throws(() => invalid.push(Buffer.from('{oops}\n')), /Invalid JSON on line 2:/);
console.log('fixture tests passed');
