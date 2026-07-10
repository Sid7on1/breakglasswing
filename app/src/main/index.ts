import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { FSWatcher } from 'node:fs';
import { Engine, EngineState } from './engine';
import { gitStatus, gitDiff, gitBranches, gitLog } from './git';
import { listDir, readFilePreview, writeFileContent, readSessionMeta, watchProject } from './files';
import { createPty, writePty, resizePty, killPty, killAllPtys } from './pty';

/**
 * Bimax desktop shell. One window, one engine child process per project directory. The renderer
 * never touches Node — everything crosses the contextBridge in preload/index.ts:
 *   renderer → main:  'engine:send' (protocol Inbound msg), 'app:pick-folder', 'engine:restart',
 *                     git:/files:/pty: (Electron-native Review/Files/Terminal subsystems)
 *   main → renderer:  'engine:msg' (protocol Outbound msg), 'engine:state', 'app:project',
 *                     'files:changed', 'pty:data', 'pty:exit'
 */

let win: BrowserWindow | null = null;
let engine: Engine | null = null;
let projectWatcher: FSWatcher | null = null;

function broadcast(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function startEngine(projectDir: string): void {
  engine?.stop();
  engine = new Engine(projectDir, {
    onMessage: (msg) => broadcast('engine:msg', msg),
    onState: (state: EngineState, detail?: string) => broadcast('engine:state', state, detail ?? ''),
  });
  engine.start();
  projectWatcher?.close();
  projectWatcher = watchProject(projectDir, () => broadcast('files:changed'));
  broadcast('app:project', projectDir);
}

function projectDir(): string {
  return engine?.projectDir || process.env.BIMAX_CWD || app.getPath('home');
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
  createWindow();

  // Default project = home dir; the engine treats non-codebase dirs as a scratch session, and the
  // renderer offers "Open Project…" (Cmd+O) to point it at a real repo.
  const initialDir = process.env.BIMAX_CWD || app.getPath('home');

  ipcMain.on('engine:send', (_e, msg: unknown) => engine?.send(msg));

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
    startEngine(engine?.projectDir || initialDir);
    return engine?.projectDir;
  });

  ipcMain.handle('app:get-project', () => engine?.projectDir ?? initialDir);

  // Composer attach: pick files, return paths relative to the project so they insert as @refs.
  ipcMain.handle('app:pick-files', async () => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      defaultPath: engine?.projectDir ?? initialDir,
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    const root = (engine?.projectDir ?? initialDir).replace(/\/+$/, '');
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
  ipcMain.on('app:renderer-ready', () => {
    if (!engine) startEngine(initialDir);
    else broadcast('app:project', engine.projectDir);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine?.stop();
  engine = null;
  killAllPtys();
  projectWatcher?.close();
  projectWatcher = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  engine?.stop();
  engine = null;
  killAllPtys();
  projectWatcher?.close();
  projectWatcher = null;
});
