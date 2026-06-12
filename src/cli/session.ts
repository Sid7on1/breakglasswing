import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageEntry } from './events';

const SESSION_DIR = path.join(process.cwd(), '.breakglass', 'sessions');

function sessionId(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
}

export class SessionStore {
  private id: string;
  private path: string;

  constructor() {
    this.id = sessionId();
    this.path = path.join(SESSION_DIR, `${this.id}.jsonl`);
  }

  async init(): Promise<MessageEntry[]> {
    await fs.mkdir(SESSION_DIR, { recursive: true });
    return [];
  }

  async append(msg: MessageEntry): Promise<void> {
    const line = JSON.stringify(msg) + '\n';
    await fs.appendFile(this.path, line, 'utf-8').catch(() => {});
  }

  getId(): string { return this.id; }

  async loadAll(): Promise<MessageEntry[]> {
    const items: MessageEntry[] = [];
    try {
      const files = await fs.readdir(SESSION_DIR);
      const sessionFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();
      for (const file of sessionFiles.slice(0, 1)) {
        const data = await fs.readFile(path.join(SESSION_DIR, file), 'utf-8');
        const lines = data.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try { items.push(JSON.parse(line)); } catch { /* skip malformed line */ }
        }
      }
    } catch { /* no session dir yet */ }
    return items;
  }

  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(SESSION_DIR);
      return files.filter(f => f.endsWith('.jsonl')).sort().reverse();
    } catch { return []; }
  }

  async loadSession(file: string): Promise<MessageEntry[]> {
    const items: MessageEntry[] = [];
    try {
      const data = await fs.readFile(path.join(SESSION_DIR, file), 'utf-8');
      const lines = data.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try { items.push(JSON.parse(line)); } catch { /* skip malformed line */ }
      }
    } catch { /* session file missing or unreadable */ }
    return items;
  }
}
