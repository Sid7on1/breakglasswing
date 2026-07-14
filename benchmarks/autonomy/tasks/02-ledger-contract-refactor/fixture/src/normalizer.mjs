export function normalizeTransaction(transaction) {
  return {
    id: transaction.id,
    account: transaction.account,
    cents: Math.round(Number(transaction.amount) * 100),
  };
}
