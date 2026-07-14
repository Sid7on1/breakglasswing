import { spawn, IPty } from '@lydell/node-pty';
import os from 'node:os';

/**
 * PTY sessions for the Terminal panel. The pty lives here in the main process so the shell
 * survives renderer-side tab switches and dock toggles; the renderer's xterm instance is just a
 * view that reattaches by session id. @lydell/node-pty ships N-API prebuilds, so this loads in
 * Electron without a native rebuild.
 */

export interface PtyEvents {
  onData: (id: number, data: string) => void;
  onExit: (id: number, code: number) => void;
}

let nextId = 1;
const sessions = new Map<number, IPty>();

export function createPty(cwd: string, cols: number, rows: number, events: PtyEvents): number {
  const shell = process.platform === 'win32'
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/zsh');
  const id = nextId++;
  const pty = spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(2, cols),
    rows: Math.max(2, rows),
    cwd: cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
  });
  sessions.set(id, pty);
  pty.onData((data) => events.onData(id, data));
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    events.onExit(id, exitCode);
  });
  return id;
}

export function writePty(id: number, data: string): void {
  sessions.get(id)?.write(data);
}

export function resizePty(id: number, cols: number, rows: number): void {
  try { sessions.get(id)?.resize(Math.max(2, cols), Math.max(2, rows)); } catch { /* exited */ }
}

export function killPty(id: number): void {
  const pty = sessions.get(id);
  sessions.delete(id);
  try { pty?.kill(); } catch { /* already gone */ }
}

export function killAllPtys(): void {
  for (const id of [...sessions.keys()]) killPty(id);
}
