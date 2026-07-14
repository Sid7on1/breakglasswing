import { writeFile } from 'node:fs/promises';
import { migrateSession } from './migrator.mjs';

export async function writeSession(file, record) {
  const migrated = migrateSession(record);
  await writeFile(file, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
  return migrated;
}
