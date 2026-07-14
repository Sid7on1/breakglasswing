Implement a reliable, idempotent v1-to-v2 session migration across this fixture's reader, migrator,
writer, and summary modules. Do not change the public exports or add dependencies.

Schema and behavior:

- A v1 record has `version: 1`, `id`, `user`, `startedAt`, `turns`, and optional `metadata` plus
  unknown top-level fields. Each turn has `role`, `text`, and may contain unknown fields.
- Its v2 form has `version: 2`, the same `id`, `owner: { id: user }`, `createdAt: startedAt`, and
  `messages`, where each message has `role`, `content: text`, and preserves unknown turn fields.
- Preserve metadata and unknown top-level fields. Remove only the replaced v1 fields `user`,
  `startedAt`, and `turns`.
- Migrating a v2 record is idempotent: it returns an equivalent v2 value. No migration, read,
  write, or summary operation may mutate caller-owned records or nested values.
- `readSession(path)` parses JSON and returns a migrated v2 record. `writeSession(path, record)`
  writes canonical v2 JSON followed by a newline and returns the same v2 value.
- Invalid JSON, unsupported versions, or missing required fields must reject/throw an error whose
  message begins `Invalid session record:`.
- `summarizeSessions(records)` returns `{ id, ownerId, createdAt, messageCount }` entries sorted by
  `createdAt` and then `id`, without reordering or mutating the input array.

Run `npm test` after the repair.
