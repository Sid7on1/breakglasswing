The cross-platform file router in this fixture mishandles some Windows paths, URL-like suffixes,
compound extensions, and precedence. Diagnose the failure and repair it without adding dependencies
or changing the exported names.

The required contract is:

- `normalizeRoutePath(input)` accepts a non-empty path string, removes a query or hash suffix,
  converts every backslash to `/`, collapses repeated separators, and lowercases the result. It must
  throw `TypeError('path must be a non-empty string')` for invalid input.
- `routeFile(input, routes)` returns the `handler` of the first matching rule, or `null` when none
  matches. Rules are checked in caller order; later rules must never override an earlier match.
- A rule has `{ extension, handler }`. Extension matching is case-insensitive, and extensions may be
  compound (for example `.test.ts`). A match must cover the end of the normalized pathname after
  query/hash removal.
- Neither the route array nor any route object may be mutated.

Run `npm test` after the change. Preserve the existing first-match router logic; the root defect is
in path normalization, even if changing the router appears to fix one example.
