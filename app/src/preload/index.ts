import { contextBridge, ipcRenderer } from 'electron';
import type { WindowChromeState } from '../shared/window.chrome';

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
  // Engine supervisor: full typed lifecycle status + validated recovery actions. The renderer
  // gets levers (retry/restart-safe/resume/minimal/stop), never raw process execution.
  supervisor: {
    onStatus: (cb: (status: unknown) => void): (() => void) => {
      const h = (_e: unknown, status: unknown): void => cb(status);
      ipcRenderer.on('supervisor:status', h);
      return () => ipcRenderer.removeListener('supervisor:status', h);
    },
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('supervisor:get-status'),
    action: (action: { action: string; sessionId?: string }): Promise<boolean> =>
      ipcRenderer.invoke('supervisor:action', action),
    crashHistory: (): Promise<unknown[]> => ipcRenderer.invoke('supervisor:crash-history'),
    diagnostics: (): Promise<string> => ipcRenderer.invoke('supervisor:diagnostics'),
  },
  /** Tells main which appearance is showing, so the native vibrancy material matches it. */
  setAppearance: (appearance: 'auto' | 'moonlight' | 'starlight'): void =>
    ipcRenderer.send('app:appearance', appearance),
  // Window chrome (full screen / zoomed). Read-only: the renderer styles itself against the window
  // state, it never drives the window from here.
  windowChrome: {
    get: (): Promise<WindowChromeState> => ipcRenderer.invoke('window:chrome'),
    onState: (cb: (state: WindowChromeState) => void): (() => void) => {
      const h = (_e: unknown, state: WindowChromeState): void => cb(state);
      ipcRenderer.on('window:chrome', h);
      return () => ipcRenderer.removeListener('window:chrome', h);
    },
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('app:pick-folder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('app:pick-files'),
  restartEngine: (): Promise<string> => ipcRenderer.invoke('engine:restart'),
  providers: {
    credentialStatus: (): Promise<unknown[]> => ipcRenderer.invoke('providers:credential-status'),
    configure: (input: { name: string; apiKey?: string; baseURL?: string }): Promise<unknown> =>
      ipcRenderer.invoke('providers:configure', input),
  },
  getProject: (): Promise<string> => ipcRenderer.invoke('app:get-project'),
  recentProjects: (): Promise<string[]> => ipcRenderer.invoke('app:recent-projects'),
  openProject: (dir: string): Promise<string | null> => ipcRenderer.invoke('app:open-project', dir),
  rendererReady: (): void => ipcRenderer.send('app:renderer-ready'),
  // Phase 9 contextual runtime surface. Both reads are bounded snapshots; the single write can
  // only report interaction/accessibility state and therefore only constrain adaptive work.
  phase9: {
    adaptiveState: (): Promise<unknown> => ipcRenderer.invoke('phase9:adaptive-state'),
    processProvenance: (): Promise<unknown[]> => ipcRenderer.invoke('phase9:process-provenance'),
    environment: (): Promise<unknown> => ipcRenderer.invoke('phase9:environment'),
    alchemistStatus: (): Promise<unknown> => ipcRenderer.invoke('phase9:alchemist-status'),
    reportInteraction: (active: boolean, reduceMotion: boolean): void =>
      ipcRenderer.send('phase9:interaction', { active, reduceMotion }),
    onAdaptiveChanged: (cb: (snapshot: unknown) => void): (() => void) => {
      const h = (_e: unknown, snapshot: unknown): void => cb(snapshot);
      ipcRenderer.on('adaptive:changed', h);
      return () => ipcRenderer.removeListener('adaptive:changed', h);
    },
  },

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
  // User takeover of the Mac. Main owns the latch (main/takeover.ts); this is the user's only
  // door to it, and the capability provider's read-only mirror is a separate loopback channel the
  // renderer never sees.
  takeover: {
    get: (): Promise<unknown> => ipcRenderer.invoke('takeover:get'),
    set: (request: { paused: boolean; reason?: string }): Promise<unknown> =>
      ipcRenderer.invoke('takeover:set', request),
    onState: (cb: (state: unknown) => void): (() => void) => {
      const h = (_e: unknown, state: unknown): void => cb(state);
      ipcRenderer.on('takeover:state', h);
      return () => ipcRenderer.removeListener('takeover:state', h);
    },
  },
  // Trust diagnostics: build identity, macOS permission state, and which executables this run
  // resolved. Read-only and non-prompting — see main/trust.ts.
  trustReport: (): Promise<unknown> => ipcRenderer.invoke('trust:report'),
  manualAlpha: {
    status: (): Promise<unknown> => ipcRenderer.invoke('trust:manual-alpha-status'),
    approve: (codeDirectoryHash: string): Promise<unknown> =>
      ipcRenderer.invoke('trust:approve-manual-alpha', codeDirectoryHash),
    revoke: (): Promise<unknown> => ipcRenderer.invoke('trust:revoke-manual-alpha'),
  },
  // Contextual evidence (Phase 8, owner section 28). Read-only from the renderer's side: it can ask
  // for a derived timeline and it can ask main to delete records, but it can never inject one.
  evidence: {
    timeline: (taskIntentId?: string): Promise<unknown> =>
      ipcRenderer.invoke('evidence:timeline', taskIntentId ?? null),
    retentionControls: (taskIntentId?: string): Promise<unknown[]> =>
      ipcRenderer.invoke('evidence:retention-controls', taskIntentId ?? null),
    remove: (scope: 'task' | 'observations' | 'all', taskIntentId?: string): Promise<number> =>
      ipcRenderer.invoke('evidence:delete', { scope, taskIntentId }),
  },
  exportDiagnostics: (): Promise<'saved' | 'cancelled' | 'failed'> =>
    ipcRenderer.invoke('trust:export-diagnostics'),
  // Takes the user to the macOS switch. Bimax never grants a permission itself.
  openPermissionSettings: (which: 'accessibility' | 'screenRecording'): Promise<boolean> =>
    ipcRenderer.invoke('trust:open-permission-settings', which),
  /**
   * The drag coach. `startCoach` opens the pane and, for add-by-drag panes, floats a compact
   * draggable app bundle over it. `setInteractive` is retained as a compatibility no-op;
   * `dragBundle` begins the real native file drag.
   */
  permissionCoach: {
    start: (which: 'accessibility' | 'screenRecording' | 'fullDisk' | 'microphone'): Promise<boolean> =>
      ipcRenderer.invoke('permissions:start-coach', which),
    startService: (which: 'accessibility' | 'screenRecording'): Promise<boolean> =>
      ipcRenderer.invoke('permissions:start-service-coach', which),
    stop: (): Promise<boolean> => ipcRenderer.invoke('permissions:stop-coach'),
    setInteractive: (interactive: boolean): void =>
      ipcRenderer.send('permissions:coach-interactive', interactive),
    dragBundle: (): void => ipcRenderer.send('permissions:drag-bundle'),
    bundlePath: (): Promise<string> => ipcRenderer.invoke('permissions:bundle-path'),
    probe: (): Promise<unknown> => ipcRenderer.invoke('permissions:probe'),
    relaunch: (): Promise<boolean> => ipcRenderer.invoke('permissions:relaunch'),
    requestMicrophone: (): Promise<boolean> => ipcRenderer.invoke('permissions:request-microphone'),
  },
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
