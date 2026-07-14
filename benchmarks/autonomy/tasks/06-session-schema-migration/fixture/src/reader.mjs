import { readFile } from 'node:fs/promises';
import { migrateSession } from './migrator.mjs';

export async function readSession(file) {
  let record;
  try {
    record = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid session record: ${error.message}`);
  }
  return migrateSession(record);
}
