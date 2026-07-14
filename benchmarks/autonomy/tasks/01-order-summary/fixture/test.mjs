import assert from 'node:assert/strict';
import { summarizeOrders } from './src/order-summary.mjs';

const orders = [
  { customer: 'Alice', status: 'paid', subtotal: 999, items: [{ quantity: 2, unitPrice: 4.25 }, { quantity: 1, unitPrice: 3 }] },
  { customer: 'Bob', status: 'paid', subtotal: 1, items: [{ quantity: 3, unitPrice: 2.1 }] },
  { customer: 'Alice', status: 'cancelled', subtotal: 100, items: [{ quantity: 1, unitPrice: 100 }] },
  { customer: 'Alice', status: 'paid', subtotal: 0, items: [{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }] },
];
const before = structuredClone(orders);

assert.deepEqual(summarizeOrders(orders), [
  { customer: 'Alice', count: 2, total: 11.8 },
  { customer: 'Bob', count: 1, total: 6.3 },
]);
assert.deepEqual(orders, before, 'summarizeOrders must not mutate its input');
console.log('fixture tests passed');
