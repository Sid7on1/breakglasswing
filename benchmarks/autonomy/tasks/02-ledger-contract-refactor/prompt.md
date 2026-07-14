The ledger fixture has inconsistent contracts across its parser, normalizer, balance builder, and
report formatter. Repair the implementation without changing the existing exported function names
or module paths. Inspect the fixture, reproduce the failure with `npm test`, make the required
multi-file changes, and rerun the focused test.

The complete required contract is:

- `parseTransactions(lines)` in `src/parser.mjs` accepts an array of strings. It ignores blank or
  whitespace-only lines. Every other line must contain exactly four pipe-delimited, non-empty fields
  in this order: `id|account|kind|amount`. It trims surrounding whitespace from every field and
  returns `{ id, account, kind, amount }` objects in input order. A malformed nonblank line must throw
  `TypeError` with the exact message `Invalid ledger line at index N`, where `N` is its zero-based
  index in the original input array. It must not mutate `lines`.
- `normalizeTransaction(transaction)` in `src/normalizer.mjs` returns a new
  `{ id, account, cents }` object. `credit` produces positive cents and `debit` produces negative
  cents. Amounts must be positive decimal strings with at most two fractional digits; conversion
  must use integer cents rather than floating-point accumulation. The id and account must be
  non-empty strings and kind must be exactly `credit` or `debit`. Any invalid transaction must throw
  `TypeError` whose message is the literal string `Invalid transaction ` (including its trailing
  space) followed immediately by `String(transaction.id)`. For example, an invalid transaction with
  id `bad-kind` must have the exact message `Invalid transaction bad-kind`. It must not mutate the
  input object.
- `buildBalances(transactions)` in `src/ledger.mjs` accepts normalized transactions, ignores every
  occurrence of an id after its first occurrence, and returns a `Map` from account name to its total
  integer cents. It must not mutate the array or transaction objects.
- `formatReport(balances)` in `src/report.mjs` accepts that `Map` and returns
  `{ account, balance }` objects. `balance` is a dollar number derived from integer cents and rounded
  to two decimal places. Sort by balance descending; ties are broken by account name ascending. It
  must not mutate the `Map`.
- `processLedger(lines)` in `src/index.mjs` must compose those four stages and return the formatted
  report with all behavior above.

Do not add dependencies or replace the focused test with a weaker assertion.
