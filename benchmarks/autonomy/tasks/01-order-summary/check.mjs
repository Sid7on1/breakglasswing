import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src', 'order-summary.mjs')).href;
const { summarizeOrders } = await import(`${moduleUrl}?check=${Date.now()}`);
const orders = [
  { customer: 'Zed', status: 'paid', subtotal: -1, items: [{ quantity: 2, unitPrice: 5 }, { quantity: 3, unitPrice: 1.25 }] },
  { customer: 'Amy', status: 'pending', subtotal: 500, items: [{ quantity: 4, unitPrice: 2.5 }] },
  { customer: 'Zed', status: 'cancelled', subtotal: 200, items: [{ quantity: 1, unitPrice: 200 }] },
];
const snapshot = structuredClone(orders);

assert.deepEqual(summarizeOrders(orders), [
  { customer: 'Amy', count: 1, total: 10 },
  { customer: 'Zed', count: 1, total: 13.75 },
]);
assert.deepEqual(orders, snapshot);
console.log('success check passed');
