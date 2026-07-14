import { migrateSession } from './migrator.mjs';

export function summarizeSessions(records) {
  // BUG: sorting the caller's array violates the public purity contract.
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(record => {
    const session = migrateSession(record);
    return {
      id: session.id,
      ownerId: session.owner.id,
      createdAt: session.createdAt,
      messageCount: session.messages.length,
    };
  });
}
