export function formatReport(balances) {
  return [...balances.entries()]
    .map(([account, cents]) => ({ account, balance: cents / 100 }))
    .sort((left, right) => left.account.localeCompare(right.account));
}
