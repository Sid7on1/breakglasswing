import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { FSWatcher, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { spawnEngineProcess, recentEngineLog } from './engine';
import { EngineSupervisor } from './supervisor/supervisor';
import { CrashJournal } from './supervisor/journal';
import { SupervisorStatus } from './supervisor/types';
import { gitStatus, gitDiff, gitBranches, gitLog } from './git';
import { listDir, readFilePreview, writeFileContent, readSessionMeta, watchProject } from './files';
import { createPty, writePty, resizePty, killPty, killAllPtys } from './pty';
import { pickInitialProject, loadSettings, recordProject, recentProjects, isRealProject } from './settings';

/**
 * Bimax desktop shell. One window, ONE authoritative EngineSupervisor owning the engine child
 * lifecycle (spawn/monitor/recover/resume — see supervisor/supervisor.ts). The renderer never
 * touches Node — everything crosses the contextBridge in preload/index.ts:
 *   renderer → main:  'engine:send' (protocol Inbound msg), 'app:pick-folder',
 *                     'supervisor:*' (typed recovery actions + diagnostics),
 *                     git:/files:/pty: (Electron-native Review/Files/Terminal subsystems)
 *   main → renderer:  'engine:msg' (protocol Outbound msg), 'engine:state' (legacy 3-state),
 *                     'supervisor:status' (full typed lifecycle), 'app:project',
 *                     'files:changed', 'pty:data', 'pty:exit'
 */

let win: BrowserWindow | null = null;
let supervisor: EngineSupervisor | null = null;
let projectWatcher: FSWatcher | null = null;
let lastStatus: SupervisorStatus | null = null;
let latestUiSnapshot: unknown = null;
let latestReviewSnapshot: unknown = null;

function broadcast(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// The old 3-state wire ('starting'|'ready'|'exited') stays for renderer parts that only need
// coarse liveness; the full lifecycle rides 'supervisor:status'.
function legacyState(s: SupervisorStatus): { state: string; detail: string } | null {
  switch (s.phase) {
    case 'idle': return null;
    case 'ready':
    case 'degraded': return { state: 'ready', detail: s.message };
    case 'exited':
    case 'failed': return { state: 'exited', detail: s.reason };
    default: return { state: 'starting', detail: s.message };
  }
}

function createSupervisor(): EngineSupervisor {
  const journalPath = path.join(app.getPath('userData'), 'crash-journal.json');
  const journal = new CrashJournal({
    load: () => {
      try { return readFileSync(journalPath, 'utf8'); } catch { return null; }
    },
    save: (text: string) => {
      // Atomic: a crash mid-write must never leave a truncated journal.
      mkdirSync(path.dirname(journalPath), { recursive: true });
      const tmp = `${journalPath}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, journalPath);
    },
  });

  return new EngineSupervisor({
    spawn: spawnEngineProcess,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
    random: () => Math.random(),
    memory: () => ({ freeBytes: os.freemem(), totalBytes: os.totalmem() }),
    env: process.env,
    journal,
    logTail: () => recentEngineLog(),
    onStatus: (status) => {
      lastStatus = status;
      broadcast('supervisor:status', status);
      const legacy = legacyState(status);
      if (legacy) broadcast('engine:state', legacy.state, legacy.detail);
    },
    onMessage: (msg: any) => {
      if (msg?.t === 'event' && msg.name === 'ui_snapshot') latestUiSnapshot = msg;
      if (msg?.t === 'event' && msg.name === 'review_update') latestReviewSnapshot = msg;
      broadcast('engine:msg', msg);
    },
    // Notices reuse the renderer's existing diagnostics pipeline (the 'log' event fold), so they
    // show up in the Health panel without a parallel plumbing path.
    onNotice: (level, text) => {
      broadcast('engine:msg', {
        t: 'event',
        name: 'log',
        args: [{ id: `sup-${Date.now()}`, level, text: `[supervisor] ${text}`, timestamp: new Date().toISOString() }],
      });
    },
  });
}

function startEngine(projectDir: string): void {
  latestUiSnapshot = null;
  latestReviewSnapshot = null;
  // macOS: window-all-closed disposes the supervisor but the app lives on — reopening a window
  // (dock click → activate) needs a fresh instance, since a disposed supervisor never respawns.
  if (!supervisor) supervisor = createSupervisor();
  supervisor.openProject(projectDir);
  projectWatcher?.close();
  projectWatcher = watchProject(projectDir, () => broadcast('files:changed'));
  broadcast('app:project', projectDir);
  // Persist so the NEXT launch resumes here instead of defaulting to $HOME (P0.1).
  recordProject(projectDir);
}

// The active project for native git/files/pty reads. Empty string when no project is open (the
// renderer shows the project-first welcome then) — never $HOME, which caused the Git/genome errors.
function projectDir(): string {
  return supervisor?.currentProject ?? '';
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'Bimax',
    backgroundColor: '#161412',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // External links open in the system browser, never inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  supervisor = createSupervisor();
  createWindow();

  // Launch project: an env override or the last valid saved project — NEVER $HOME. When null, the
  // renderer shows the project-first welcome and we don't boot an engine in the wrong place (P0.1).
  const initialDir = pickInitialProject(loadSettings().lastProject);

  // Protocol messages from the renderer flow through the supervisor: delivered when the engine is
  // interactive, queued when safe to replay, rejected with a visible notice otherwise.
  ipcMain.on('engine:send', (_e, msg: unknown) => supervisor?.sendFromRenderer(msg));

  ipcMain.handle('app:pick-folder', async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Open Project',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const dir = res.filePaths[0];
    startEngine(dir);
    return dir;
  });

  ipcMain.handle('engine:restart', () => {
    // Restart the current project, or re-resolve one if none is open. No valid project → stay on
    // the welcome (never boot $HOME).
    const dir = supervisor?.currentProject || pickInitialProject(loadSettings().lastProject);
    if (dir) startEngine(dir);
    else broadcast('app:project', '');
    return supervisor?.currentProject ?? '';
  });

  // Supervisor surface: typed state + validated recovery actions. The renderer never gets raw
  // process access — these are the only levers.
  ipcMain.handle('supervisor:get-status', () => lastStatus ?? supervisor?.status() ?? null);
  ipcMain.handle('supervisor:action', (_e, raw: unknown) => supervisor?.handleAction(raw) ?? false);
  ipcMain.handle('supervisor:crash-history', () => supervisor?.crashHistory() ?? []);
  ipcMain.handle('supervisor:diagnostics', () => supervisor?.diagnosticsText() ?? '');

  ipcMain.handle('app:get-project', () => projectDir());

  // Recent projects for the welcome screen (validated, most-recent first).
  ipcMain.handle('app:recent-projects', () => recentProjects());

  // Open a specific recent project by path (from the welcome list).
  ipcMain.handle('app:open-project', (_e, dir: string) => {
    if (isRealProject(dir)) { startEngine(dir); return dir; }
    return null;
  });

  // Composer attach: pick files, return paths relative to the project so they insert as @refs.
  ipcMain.handle('app:pick-files', async () => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      defaultPath: projectDir() || undefined,
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    const root = projectDir().replace(/\/+$/, '');
    return res.filePaths.map((p) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p));
  });

  // Review panel — native git reads (writes go through the engine's /git for attribution).
  ipcMain.handle('git:status', () => gitStatus(projectDir()));
  ipcMain.handle('git:diff', (_e, file: string, untracked: boolean) => gitDiff(projectDir(), String(file), !!untracked));
  ipcMain.handle('git:branches', () => gitBranches(projectDir()));
  ipcMain.handle('git:log', (_e, n: number) => gitLog(projectDir(), Number(n) || 15));

  // Files panel — lazy tree + capped read-only viewer.
  ipcMain.handle('files:list', (_e, rel: string) => listDir(projectDir(), String(rel ?? '')));
  ipcMain.handle('files:read', (_e, rel: string) => readFilePreview(projectDir(), String(rel)));
  ipcMain.handle('files:reveal', (_e, rel: string) => {
    shell.showItemInFolder(path.resolve(projectDir(), String(rel)));
  });
  // Editor pane ⌘S — the user's own edit, so it writes directly like any IDE (agent edits still
  // flow through the engine's tools + Edit Shield).
  ipcMain.handle('files:write', (_e, rel: string, content: string) =>
    writeFileContent(projectDir(), String(rel), String(content)));

  // Home dashboard + Sessions gallery: full session history from the engine's meta JSONL.
  ipcMain.handle('sessions:meta', () => readSessionMeta(projectDir()));

  // Terminal panel — pty lives here so the shell survives renderer tab switches.
  ipcMain.handle('pty:create', (_e, cols: number, rows: number) =>
    createPty(projectDir(), Number(cols) || 80, Number(rows) || 24, {
      onData: (id, data) => broadcast('pty:data', id, data),
      onExit: (id, code) => broadcast('pty:exit', id, code),
    }));
  ipcMain.on('pty:input', (_e, id: number, data: string) => writePty(Number(id), String(data)));
  ipcMain.on('pty:resize', (_e, id: number, cols: number, rows: number) => resizePty(Number(id), Number(cols), Number(rows)));
  ipcMain.on('pty:kill', (_e, id: number) => killPty(Number(id)));

  // Renderer signals it has mounted its listeners; only then spawn (so no early events are lost).
  // With a valid saved/override project we boot it; otherwise we broadcast an empty project so the
  // renderer shows the project-first welcome instead of an engine running in $HOME (P0.1).
  ipcMain.on('app:renderer-ready', () => {
    const dir = projectDir();
    if (dir) {
      broadcast('app:project', dir);
      if (lastStatus) {
        broadcast('supervisor:status', lastStatus);
        const legacy = legacyState(lastStatus);
        if (legacy) broadcast('engine:state', legacy.state, legacy.detail);
      }
      // Renderer reload/reconnect: replay the latest full snapshots so missing intermediate events
      // cannot leave repository or task-review state stale.
      if (latestUiSnapshot) broadcast('engine:msg', latestUiSnapshot);
      if (latestReviewSnapshot) broadcast('engine:msg', latestReviewSnapshot);
      return;
    }
    if (initialDir) startEngine(initialDir);
    else broadcast('app:project', '');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// dispose() supersedes the child and cancels every timer — the supervisor can never relaunch the
// engine while the app is quitting.
app.on('window-all-closed', () => {
  supervisor?.dispose();
  supervisor = null;
  killAllPtys();
  projectWatcher?.close();
  projectWatcher = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  supervisor?.dispose();
  supervisor = null;
  killAllPtys();
  projectWatcher?.close();
  projectWatcher = null;
});
