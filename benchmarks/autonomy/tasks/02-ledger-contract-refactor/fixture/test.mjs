import assert from 'node:assert/strict';
import { parseTransactions } from './src/parser.mjs';
import { normalizeTransaction } from './src/normalizer.mjs';
import { buildBalances } from './src/ledger.mjs';
import { formatReport } from './src/report.mjs';
import { processLedger } from './src/index.mjs';

const lines = Object.freeze([
  ' a-1 | Checking | credit | 12.40 ',
  'b-2|Travel|credit|5.20',
  'c-3|Checking|debit|2.40',
  'b-2|Travel|credit|500.00',
  'd-4|Meals|credit|5.20',
]);
const before = [...lines];

assert.deepEqual(parseTransactions(lines.slice(0, 1)), [
  { id: 'a-1', account: 'Checking', kind: 'credit', amount: '12.40' },
]);
assert.deepEqual(
  normalizeTransaction({ id: 'd', account: 'Travel', kind: 'debit', amount: '1.25' }),
  { id: 'd', account: 'Travel', cents: -125 },
);
assert.deepEqual(buildBalances([
  { id: 'x', account: 'A', cents: 100 },
  { id: 'x', account: 'A', cents: 900 },
]), new Map([['A', 100]]));
assert.deepEqual(formatReport(new Map([['Z', 250], ['A', 400], ['B', 400]])), [
  { account: 'A', balance: 4 },
  { account: 'B', balance: 4 },
  { account: 'Z', balance: 2.5 },
]);
assert.deepEqual(processLedger(lines), [
  { account: 'Checking', balance: 10 },
  { account: 'Meals', balance: 5.2 },
  { account: 'Travel', balance: 5.2 },
]);
assert.deepEqual(lines, before, 'the pipeline must not mutate input lines');
console.log('fixture tests passed');
