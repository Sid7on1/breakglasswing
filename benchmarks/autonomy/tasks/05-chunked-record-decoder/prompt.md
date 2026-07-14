Repair the incremental NDJSON decoder in `src/decoder.mjs`. It currently treats each byte chunk as
an independent string, which fails under real stream boundaries. Keep the public
`createRecordDecoder()` export and add no dependencies.

Required behavior:

- `push(chunk)` accepts a `Buffer` or `Uint8Array` and returns every complete decoded JSON value
  produced by that chunk, in order.
- Arbitrary byte boundaries must work, including boundaries inside a multi-byte UTF-8 character,
  inside JSON syntax, and between `\r` and `\n`.
- Both LF and CRLF delimit records. Empty lines are ignored but still advance the physical line
  number.
- `flush()` finishes UTF-8 decoding and parses a final non-empty record without requiring a newline.
  Repeated `flush()` calls return an empty array.
- Invalid JSON throws `Error('Invalid JSON on line N: <parser message>')`, where `N` is the physical
  one-based input line. A decoder that has thrown need not be reused.
- The decoder must not mutate supplied buffers or option-like caller values.

Run `npm test` after the repair.
