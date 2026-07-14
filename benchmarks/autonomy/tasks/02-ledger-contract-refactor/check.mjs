import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceUrl = file => `${pathToFileURL(path.join(process.cwd(), 'src', file)).href}?check=${Date.now()}`;
const { parseTransactions } = await import(sourceUrl('parser.mjs'));
const { normalizeTransaction } = await import(sourceUrl('normalizer.mjs'));
const { buildBalances } = await import(sourceUrl('ledger.mjs'));
const { formatReport } = await import(sourceUrl('report.mjs'));
const { processLedger } = await import(sourceUrl('index.mjs'));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const lines = Object.freeze([
  ' z-17 | Operations | credit | 10.05 ',
  'q-2|Research|credit|4.00',
  'd-8|Operations|debit|2.05',
  '   ',
  'q-2|Ignored duplicate|credit|999.99',
  's-4|Sales|credit|8.00',
  'r-9|Research|debit|1.25',
]);
const linesBefore = [...lines];

assert.deepEqual(parseTransactions(lines.slice(0, 3)), [
  { id: 'z-17', account: 'Operations', kind: 'credit', amount: '10.05' },
  { id: 'q-2', account: 'Research', kind: 'credit', amount: '4.00' },
  { id: 'd-8', account: 'Operations', kind: 'debit', amount: '2.05' },
]);
assert.throws(
  () => parseTransactions(['ok|A|credit|1.00', 'broken|line']),
  { name: 'TypeError', message: 'Invalid ledger line at index 1' },
);
assert.deepEqual(lines, linesBefore, 'parseTransactions must not mutate its input');

const rawDebit = deepFreeze({ id: 'fee-3', account: 'Fees', kind: 'debit', amount: '0.07' });
const rawDebitBefore = structuredClone(rawDebit);
assert.deepEqual(normalizeTransaction(rawDebit), { id: 'fee-3', account: 'Fees', cents: -7 });
assert.deepEqual(rawDebit, rawDebitBefore, 'normalizeTransaction must not mutate its input');
assert.throws(
  () => normalizeTransaction({ id: 'bad-kind', account: 'A', kind: 'refund', amount: '1.00' }),
  { name: 'TypeError', message: 'Invalid transaction bad-kind' },
);
assert.throws(
  () => normalizeTransaction({ id: 'bad-money', account: 'A', kind: 'credit', amount: '1.005' }),
  { name: 'TypeError', message: 'Invalid transaction bad-money' },
);

const normalized = deepFreeze([
  { id: 'one', account: 'North', cents: 501 },
  { id: 'two', account: 'South', cents: 501 },
  { id: 'one', account: 'North', cents: 99999 },
  { id: 'three', account: 'North', cents: -1 },
]);
const normalizedBefore = structuredClone(normalized);
assert.deepEqual(buildBalances(normalized), new Map([['North', 500], ['South', 501]]));
assert.deepEqual(normalized, normalizedBefore, 'buildBalances must not mutate its input');

const reportInput = new Map([['Zulu', 275], ['Alpha', 800], ['Beta', 800]]);
const reportInputBefore = [...reportInput.entries()];
assert.deepEqual(formatReport(reportInput), [
  { account: 'Alpha', balance: 8 },
  { account: 'Beta', balance: 8 },
  { account: 'Zulu', balance: 2.75 },
]);
assert.deepEqual([...reportInput.entries()], reportInputBefore, 'formatReport must not mutate its Map');

assert.deepEqual(processLedger(lines), [
  { account: 'Operations', balance: 8 },
  { account: 'Sales', balance: 8 },
  { account: 'Research', balance: 2.75 },
]);
assert.deepEqual(lines, linesBefore, 'processLedger must not mutate its input');
console.log('success check passed');
