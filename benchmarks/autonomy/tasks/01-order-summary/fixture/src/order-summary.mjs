export function summarizeOrders(orders) {
  const summary = new Map();

  for (const order of orders) {
    const current = summary.get(order.customer) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += order.subtotal;
    summary.set(order.customer, current);
  }

  return [...summary.entries()].map(([customer, data]) => ({ customer, ...data }));
}
