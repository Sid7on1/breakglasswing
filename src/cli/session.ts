import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageEntry } from './events';
import { Message } from '../core/llm.provider';

/**
 * Convert persisted UI transcript entries (MessageEntry) into clean LLM history (Message[]).
 *
 * Sessions store the UI shape: `content` can be a React node, tool exchanges are collapsed onto the
 * assistant entry as `toolCalls` (not the API's `tool_calls` + separate `tool` role), and there are
 * UI-only fields (id, timestamp). Assigning those straight to `persona.messages` sent malformed
 * payloads to the provider (non-string content, orphaned tool shapes). This produces text-only
 * user/assistant turns — folding each collapsed tool call into a readable note so context survives —
 * which every provider accepts. System/divider entries are dropped (re-derived per turn).
 */
export function messageEntriesToLLM(entries: MessageEntry[]): Message[] {
  const out: Message[] = [];
  for (const e of entries) {
    if (e.role !== 'user' && e.role !== 'assistant') continue; // drop system/UI dividers
    let text = typeof e.content === 'string' ? e.content : '';
    if (e.role === 'assistant' && e.toolCalls && e.toolCalls.length > 0) {
      const note = e.toolCalls
        .map(tc => `[used ${tc.toolName}(${(tc.input || '').slice(0, 200)}) → ${(tc.output || '').slice(0, 800)}]`)
        .join('\n');
      text = text ? `${text}\n\n${note}` : note;
    }
    if (!text.trim()) continue; // skip empty turns the model can't use
    out.push({ role: e.role, content: text });
  }
  return out;
}

const SESSION_DIR = path.join(process.cwd(), '.breakglass', 'sessions');
const BRANCH_DIR = path.join(SESSION_DIR, 'branches');

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

  // --- Branch support ---

  /** Fork the current live messages into a named branch for later resumption. */
  async saveBranch(name: string, messages: MessageEntry[]): Promise<void> {
    await fs.mkdir(BRANCH_DIR, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const branchPath = path.join(BRANCH_DIR, `${safeName}.jsonl`);
    const lines = messages.map(m => JSON.stringify(m)).join('\n');
    await fs.writeFile(branchPath, lines + '\n', 'utf-8');
  }

  /** List all saved branch names (without extension). */
  async listBranches(): Promise<string[]> {
    try {
      const files = await fs.readdir(BRANCH_DIR);
      return files.filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)).sort();
    } catch { return []; }
  }

  /** Load a named branch's messages. */
  async loadBranch(name: string): Promise<MessageEntry[]> {
    const items: MessageEntry[] = [];
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const data = await fs.readFile(path.join(BRANCH_DIR, `${safeName}.jsonl`), 'utf-8');
      const lines = data.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try { items.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    } catch { /* branch missing */ }
    return items;
  }

  /** Delete a named branch. */
  async deleteBranch(name: string): Promise<boolean> {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      await fs.rm(path.join(BRANCH_DIR, `${safeName}.jsonl`));
      return true;
    } catch { return false; }
  }
}
