import { promises as fs, watch, FSWatcher } from 'node:fs';
import path from 'node:path';
import { resolveWithinRoot } from './security';

/**
 * Electron-native file tree for the Files panel: lazy per-directory listing, capped read-only
 * file reads, and one recursive watcher per project that fans change events to the renderer
 * (debounced — a `git checkout` touches hundreds of files at once).
 */

const IGNORE = new Set(['node_modules', '.git', '.DS_Store']);
const MAX_READ = 512 * 1024; // viewer is read-only; past this we truncate with a notice

export interface FileEntry {
  name: string;
  dir: boolean;
}

/**
 * Resolve a project-relative path, refusing anything that escapes the root — including the
 * no-project-open case, where an empty root used to make every absolute path look contained.
 * The containment rule itself lives in security.ts so the IPC layer and this module cannot drift.
 */
function safeJoin(root: string, rel: unknown): string {
  return resolveWithinRoot(root, rel, 'path');
}

export async function listDir(root: string, rel: unknown): Promise<FileEntry[]> {
  const abs = safeJoin(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

export async function readFilePreview(
  root: string, rel: unknown,
): Promise<{ content: string; truncated: boolean; size: number; binary: boolean }> {
  const abs = safeJoin(root, rel);
  const stat = await fs.stat(abs);
  const fh = await fs.open(abs, 'r');
  try {
    const len = Math.min(stat.size, MAX_READ);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    const binary = buf.includes(0);
    return {
      content: binary ? '' : buf.toString('utf8'),
      truncated: stat.size > MAX_READ,
      size: stat.size,
      binary,
    };
  } finally {
    await fh.close();
  }
}

/** Editor-pane save (⌘S). Same path guard as reads; refuses only what read refused. */
export async function writeFileContent(root: string, rel: unknown, content: string): Promise<void> {
  const abs = safeJoin(root, rel);
  await fs.writeFile(abs, content, 'utf8');
}

/** One session-meta record from the engine's .breakglass/sessions/sessions-meta.jsonl. */
export interface SessionMetaRecord {
  id: string;
  title: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  tokenEstimate: number;
}

/**
 * Read the FULL session history for the Home dashboard + Sessions gallery. The engine's
 * ui_snapshot caps its list at 20 (it rides every snapshot frame); stats want everything, and
 * the meta file is plain JSONL in the project dir — so the shell reads it natively, like git.
 */
export async function readSessionMeta(root: string): Promise<SessionMetaRecord[]> {
  try {
    const raw = await fs.readFile(path.join(root, '.breakglass', 'sessions', 'sessions-meta.jsonl'), 'utf8');
    const out: SessionMetaRecord[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        out.push({
          id: String(m.id ?? ''),
          title: String(m.title ?? ''),
          cwd: String(m.cwd ?? ''),
          startedAt: String(m.startedAt ?? ''),
          endedAt: m.endedAt ? String(m.endedAt) : undefined,
          messageCount: Number(m.messageCount ?? 0),
          tokenEstimate: Number(m.tokenEstimate ?? 0),
        });
      } catch { /* skip malformed line */ }
    }
    return out.reverse(); // newest first
  } catch {
    return [];
  }
}

export function watchProject(root: string, onChange: () => void): FSWatcher | null {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '');
      if (name.split(path.sep).some((seg) => IGNORE.has(seg))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 400);
    });
    watcher.on('error', () => { /* project deleted mid-session — polling still covers git */ });
    return watcher;
  } catch {
    return null; // recursive watch unavailable — renderer's poll interval still refreshes
  }
}
