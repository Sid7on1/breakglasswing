import { CrashRecord } from './types';

/**
 * Durable crash journal — bounded, redacted, desktop-owned. The desktop writes it, so even a
 * SIGKILLed engine (which can't flush anything) leaves evidence. Storage is injected as a tiny
 * text-blob interface; the Electron adapter implements it with atomic tmp+rename writes under
 * the app's userData directory.
 */

export const MAX_RECORDS = 30;
export const MAX_LOG_TAIL_CHARS = 6_000;

export interface JournalStore {
  load(): string | null;          // null when missing/unreadable
  save(text: string): void;       // must be atomic (tmp + rename in the adapter)
}

// Secrets never belong in a crash journal. These run over the log tail (engine stderr can echo
// env or config fragments). Patterns are deliberately eager — a redacted non-secret costs nothing,
// a leaked key costs plenty.
const REDACTIONS: Array<[RegExp, string]> = [
  // bearer headers — must run BEFORE the key=value rule: in `authorization: Bearer <jwt>` that
  // rule's \S+ value consumes just the word "Bearer", leaving the token itself in the clear
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]'],
  // key=value style env/config assignments for sensitive names
  [/((?:api[-_]?key|secret|token|password|passwd|credential|authorization)[\w-]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]'],
  // bare JWT shape (three dot-separated base64url segments), wherever it appears
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[REDACTED]'],
  // well-known key shapes: OpenAI/Anthropic-style sk-…, GitHub ghp_…, AWS AKIA…
  [/\b(sk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, sub] of REDACTIONS) out = out.replace(re, sub);
  return out;
}

/** Fold a new record into the bounded list: redact + clamp its log tail, cap history length. */
export function appendRecord(records: CrashRecord[], rec: CrashRecord): CrashRecord[] {
  const clamped: CrashRecord = {
    ...rec,
    logTail: redactSecrets(rec.logTail ?? '').slice(-MAX_LOG_TAIL_CHARS),
  };
  return [...records, clamped].slice(-MAX_RECORDS);
}

export function parseJournal(text: string | null): CrashRecord[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.records) ? (parsed.records as CrashRecord[]) : [];
  } catch {
    return []; // a corrupt journal must never block recovery — start fresh
  }
}

export function serializeJournal(records: CrashRecord[]): string {
  return JSON.stringify({ version: 1, records }, null, 2);
}

export class CrashJournal {
  constructor(private store: JournalStore) {}

  list(): CrashRecord[] {
    return parseJournal(this.store.load());
  }

  append(rec: CrashRecord): CrashRecord[] {
    const next = appendRecord(this.list(), rec);
    try { this.store.save(serializeJournal(next)); } catch { /* journal failure must never block recovery */ }
    return next;
  }

  /** Patch the most recent record (e.g. fill in the recovery outcome once known). */
  amendLast(patch: Partial<CrashRecord>): void {
    const records = this.list();
    if (records.length === 0) return;
    records[records.length - 1] = { ...records[records.length - 1], ...patch };
    try { this.store.save(serializeJournal(records)); } catch { /* best-effort */ }
  }
}
