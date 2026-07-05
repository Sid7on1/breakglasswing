import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { WorkspaceManager, initWorkspace } from '../core/workspace.manager';
import { workspaceWriteBlock } from '../tools/path.util';

function mkRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('WorkspaceManager (multi-repo workspace, PR1)', () => {
  let root: string;
  let primary: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-ws-'));
    primary = mkRepo(path.join(root, 'primary'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('registers the primary repo writable on refresh and persists the manifest', () => {
    const ws = new WorkspaceManager(primary);
    ws.refresh();
    const act = ws.active();
    expect(act.length).toBe(1);
    expect(act[0].scope).toBe('write');
    expect(act[0].name).toBe('primary');
    expect(fs.existsSync(path.join(primary, '.bimax', 'workspace.json'))).toBe(true);
  });

  it('registers additional repos read-only by default and scopes them', () => {
    const other = mkRepo(path.join(root, 'reference'));
    const ws = new WorkspaceManager(primary);
    ws.refresh();
    const r = ws.register(other, { purpose: 'pattern source' });
    expect(r.scope).toBe('read');

    expect(ws.checkWrite(path.join(other, 'lib.ts')).allowed).toBe(false);
    expect(ws.checkWrite(path.join(primary, 'src', 'a.ts')).allowed).toBe(true);
    // Paths outside every registered repo keep today's behavior.
    expect(ws.checkWrite(path.join(root, 'elsewhere', 'x.txt')).allowed).toBe(true);

    ws.setScope(other, 'write');
    expect(ws.checkWrite(path.join(other, 'lib.ts')).allowed).toBe(true);
  });

  it('detects a git clone from a shell command and queues it as an ask-once candidate', () => {
    const cloned = mkRepo(path.join(root, 'fresh-find'));
    const ws = new WorkspaceManager(primary);
    ws.refresh();
    ws.noticeCommand(`git clone https://github.com/x/fresh-find ${cloned}`, root);
    expect(ws.pending()).toContain(cloned);

    // ignore = ask-once "no": never suggested again, even after a rescan.
    ws.ignore(cloned);
    expect(ws.pending()).not.toContain(cloned);
    ws.scan(root);
    expect(ws.pending()).not.toContain(cloned);
  });

  it('derives the clone target dir from the URL when none is given', () => {
    const cloned = mkRepo(path.join(root, 'by-url'));
    const ws = new WorkspaceManager(primary);
    ws.noticeCommand('git clone https://github.com/someone/by-url.git', root);
    expect(ws.pending()).toContain(cloned);
  });

  it('survives reload: registrations and scopes come back from the manifest', () => {
    const other = mkRepo(path.join(root, 'reference'));
    const ws1 = new WorkspaceManager(primary);
    ws1.refresh();
    ws1.register(other, { purpose: 'ref', scope: 'write' });

    const ws2 = new WorkspaceManager(primary);
    const found = ws2.find(other);
    expect(found?.scope).toBe('write');
    expect(found?.purpose).toBe('ref');
  });

  it('exposes the context block and snapshot only in multi-repo sessions', () => {
    const ws = new WorkspaceManager(primary);
    ws.refresh();
    expect(ws.contextBlock()).toBe(''); // single repo: no block, zero prompt cost

    const other = mkRepo(path.join(root, 'reference'));
    ws.register(other, { purpose: 'pattern source' });
    const block = ws.contextBlock();
    expect(block).toContain('WORKSPACE (2 repos)');
    expect(block).toContain('reference (read-only)');
    expect(ws.snapshot()).toEqual({ count: 2, names: ['primary', 'reference'], writable: 1 });
  });

  it('workspaceWriteBlock wires the singleton into the write tools', () => {
    const other = mkRepo(path.join(root, 'readonly-ref'));
    initWorkspace(primary);
    const ws = require('../core/workspace.manager').getWorkspace();
    ws.register(other);
    expect(workspaceWriteBlock(path.join(other, 'x.ts'))).toContain('READ-ONLY');
    expect(workspaceWriteBlock(path.join(primary, 'x.ts'))).toBeNull();
  });
});
