export function parseTransactions(lines) {
  return lines
    .filter(Boolean)
    .map(line => {
      const [id, account, kind, amount] = line.split('|');
      return { id, account, kind, amount };
    });
}
