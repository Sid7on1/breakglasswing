import { parseTransactions } from './parser.mjs';
import { normalizeTransaction } from './normalizer.mjs';
import { buildBalances } from './ledger.mjs';
import { formatReport } from './report.mjs';

export function processLedger(lines) {
  const parsed = parseTransactions(lines);
  const normalized = parsed.map(normalizeTransaction);
  const balances = buildBalances(normalized);
  return formatReport(balances);
}
