function invalid(message) {
  throw new Error(`Invalid session record: ${message}`);
}

export function migrateSession(record) {
  if (!record || typeof record !== 'object') invalid('expected an object');
  if (record.version === 2) return record;
  if (record.version !== 1) invalid('unsupported version');
  if (!record.id || !record.user || !record.startedAt || !Array.isArray(record.turns)) {
    invalid('missing required v1 fields');
  }

  // BUG: this mutates the caller and discards metadata while translating the schema.
  record.version = 2;
  record.owner = { id: record.user };
  record.createdAt = record.startedAt;
  record.messages = record.turns.map(turn => ({ role: turn.role, content: turn.text }));
  record.metadata = {};
  delete record.user;
  delete record.startedAt;
  delete record.turns;
  return record;
}
