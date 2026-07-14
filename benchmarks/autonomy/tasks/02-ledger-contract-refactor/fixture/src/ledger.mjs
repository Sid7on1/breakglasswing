export function buildBalances(transactions) {
  const balances = new Map();

  for (const transaction of transactions) {
    balances.set(
      transaction.account,
      (balances.get(transaction.account) ?? 0) + transaction.cents,
    );
  }

  return balances;
}
