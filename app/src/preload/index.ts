import { contextBridge, ipcRenderer } from 'electron';

/**
 * The renderer's only door to the engine. Mirrors the NDJSON protocol 1:1 — `send` takes a
 * protocol Inbound message, `onMessage` yields protocol Outbound messages (src/protocol/protocol.ts
 * in the engine repo; mirrored types live in renderer/src/protocol.ts).
 */
const api = {
  send: (msg: unknown): void => ipcRenderer.send('engine:send', msg),
  onMessage: (cb: (msg: unknown) => void): (() => void) => {
    const h = (_e: unknown, msg: unknown): void => cb(msg);
    ipcRenderer.on('engine:msg', h);
    return () => ipcRenderer.removeListener('engine:msg', h);
  },
  onEngineState: (cb: (state: string, detail: string) => void): (() => void) => {
    const h = (_e: unknown, state: string, detail: string): void => cb(state, detail);
    ipcRenderer.on('engine:state', h);
    return () => ipcRenderer.removeListener('engine:state', h);
  },
  onProject: (cb: (dir: string) => void): (() => void) => {
    const h = (_e: unknown, dir: string): void => cb(dir);
    ipcRenderer.on('app:project', h);
    return () => ipcRenderer.removeListener('app:project', h);
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('app:pick-folder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('app:pick-files'),
  restartEngine: (): Promise<string> => ipcRenderer.invoke('engine:restart'),
  getProject: (): Promise<string> => ipcRenderer.invoke('app:get-project'),
  rendererReady: (): void => ipcRenderer.send('app:renderer-ready'),

  // Electron-native dock subsystems (P3): git reads, file tree, pty terminal.
  git: {
    status: (): Promise<unknown> => ipcRenderer.invoke('git:status'),
    diff: (file: string, untracked: boolean): Promise<string> => ipcRenderer.invoke('git:diff', file, untracked),
    branches: (): Promise<unknown> => ipcRenderer.invoke('git:branches'),
    log: (n: number): Promise<unknown> => ipcRenderer.invoke('git:log', n),
  },
  files: {
    list: (rel: string): Promise<unknown> => ipcRenderer.invoke('files:list', rel),
    read: (rel: string): Promise<unknown> => ipcRenderer.invoke('files:read', rel),
    reveal: (rel: string): Promise<void> => ipcRenderer.invoke('files:reveal', rel),
    write: (rel: string, content: string): Promise<void> => ipcRenderer.invoke('files:write', rel, content),
    onChanged: (cb: () => void): (() => void) => {
      const h = (): void => cb();
      ipcRenderer.on('files:changed', h);
      return () => ipcRenderer.removeListener('files:changed', h);
    },
  },
  sessionsMeta: (): Promise<unknown> => ipcRenderer.invoke('sessions:meta'),
  pty: {
    create: (cols: number, rows: number): Promise<number> => ipcRenderer.invoke('pty:create', cols, rows),
    input: (id: number, data: string): void => ipcRenderer.send('pty:input', id, data),
    resize: (id: number, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: number): void => ipcRenderer.send('pty:kill', id),
    onData: (cb: (id: number, data: string) => void): (() => void) => {
      const h = (_e: unknown, id: number, data: string): void => cb(id, data);
      ipcRenderer.on('pty:data', h);
      return () => ipcRenderer.removeListener('pty:data', h);
    },
    onExit: (cb: (id: number, code: number) => void): (() => void) => {
      const h = (_e: unknown, id: number, code: number): void => cb(id, code);
      ipcRenderer.on('pty:exit', h);
      return () => ipcRenderer.removeListener('pty:exit', h);
    },
  },
};

contextBridge.exposeInMainWorld('bimax', api);

export type BimaxApi = typeof api;
