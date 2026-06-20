import * as fs from 'fs';
import * as path from 'path';

export interface SessionMeta {
  id: string;           // same as the JSONL filename stem
  title: string;        // first user message, truncated
  cwd: string;          // working directory when session started
  startedAt: string;    // ISO
  endedAt?: string;     // ISO — set on shutdown
  messageCount: number;
  tokenEstimate: number;
  goalId?: string;      // active GoalManager goal at session start
  goalTitle?: string;
}

const META_FILE = '.breakglass/sessions/sessions-meta.jsonl';

// Capture cwd once at module load — process.cwd() on every call is redundant
// and could theoretically return a different value if someone calls chdir().
const _metaPath = path.join(process.cwd(), META_FILE);

function readAllMeta(): SessionMeta[] {
  try {
    const raw = fs.readFileSync(_metaPath, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as SessionMeta);
  } catch {
    return [];
  }
}

function appendMeta(meta: SessionMeta): void {
  try {
    fs.mkdirSync(path.dirname(_metaPath), { recursive: true });
    fs.appendFileSync(_metaPath, JSON.stringify(meta) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

function updateMeta(id: string, updates: Partial<SessionMeta>): void {
  try {
    const all = readAllMeta();
    const idx = all.findIndex(m => m.id === id);
    if (idx === -1) return;
    all[idx] = { ...all[idx], ...updates };
    fs.writeFileSync(_metaPath, all.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8');
  } catch { /* best-effort */ }
}

// --- Module-level session tracker ---

let _current: SessionMeta | null = null;

// Progress writes are debounced so a long session doesn't trigger O(n) JSONL rewrites on
// every assistant message. The timer fires 10s after the last update; endSessionMeta() always
// flushes immediately regardless.
let _progressTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleProgressFlush(): void {
  if (_progressTimer) return;
  _progressTimer = setTimeout(() => {
    _progressTimer = null;
    if (_current) updateMeta(_current.id, { messageCount: _current.messageCount, tokenEstimate: _current.tokenEstimate });
  }, 10_000);
}

/** Called at session start (in FullScreen after sessionRef.init()). */
export function startSessionMeta(sessionId: string, cwd: string, goalId?: string, goalTitle?: string): void {
  _current = {
    id: sessionId,
    title: '(no messages yet)',
    cwd,
    startedAt: new Date().toISOString(),
    messageCount: 0,
    tokenEstimate: 0,
    goalId,
    goalTitle,
  };
  appendMeta(_current);
}

/** Called when the first user message arrives — sets the session title. */
export function recordFirstUserMessage(text: string): void {
  if (!_current || _current.title !== '(no messages yet)') return;
  _current.title = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  updateMeta(_current.id, { title: _current.title });
}

/** Called on each assistant message — keeps message count and token estimate current. */
export function recordSessionProgress(messageCount: number, tokenEstimate: number): void {
  if (!_current) return;
  _current.messageCount = messageCount;
  _current.tokenEstimate = tokenEstimate;
  scheduleProgressFlush();
}

/** Called on shutdown — flushes any pending progress and marks the session as ended. */
export function endSessionMeta(): void {
  if (!_current) return;
  if (_progressTimer) { clearTimeout(_progressTimer); _progressTimer = null; }
  updateMeta(_current.id, {
    messageCount: _current.messageCount,
    tokenEstimate: _current.tokenEstimate,
    endedAt: new Date().toISOString(),
  });
  _current = null;
}

export function getCurrentSessionId(): string | null {
  return _current?.id ?? null;
}

/** Returns the most recent N session metadata records, newest first. */
export function listSessionMeta(n = 40): SessionMeta[] {
  return readAllMeta().reverse().slice(0, n);
}
