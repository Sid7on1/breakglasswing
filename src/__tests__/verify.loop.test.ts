import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyHook, setVerifyEnabled, registerVerifyGraphStore } from '../sandbox/verify.loop';
import { buildTool } from '../tools/tool.factory';
import { registerPostHook, clearHooks } from '../tools/hooks';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

afterEach(() => { setVerifyEnabled(false); registerVerifyGraphStore(null); clearHooks(); });

describe('verifyHook (B2)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-verify-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appends diagnostics when an edited JS file has a syntax error', async () => {
    const f = path.join(dir, 'broken.js');
    fs.writeFileSync(f, 'function x( { return 1 }\n'); // syntax error
    setVerifyEnabled(true);
    const out = await verifyHook('EditFileTool', { path: f }, 'Edited broken.js', { cwd: dir });
    expect(out && (out as any).appendToResult).toMatch(/Auto-verify failed/);
  });

  it('is a no-op for a valid JS file', async () => {
    const f = path.join(dir, 'ok.js');
    fs.writeFileSync(f, 'function x() { return 1; }\n');
    setVerifyEnabled(true);
    const out = await verifyHook('EditFileTool', { path: f }, 'Edited ok.js', { cwd: dir });
    expect(out).toBeUndefined();
  });

  it('is a no-op when disabled', async () => {
    const f = path.join(dir, 'broken.js');
    fs.writeFileSync(f, 'function x( {\n');
    setVerifyEnabled(false);
    expect(await verifyHook('EditFileTool', { path: f }, 'Edited', { cwd: dir })).toBeUndefined();
  });

  it('skips non-code files', async () => {
    const f = path.join(dir, 'notes.md');
    fs.writeFileSync(f, '# hi\n');
    setVerifyEnabled(true);
    expect(await verifyHook('WriteFileTool', { path: f }, 'wrote', { cwd: dir })).toBeUndefined();
  });

  it('skips when the edit result indicates failure', async () => {
    const f = path.join(dir, 'broken.js');
    fs.writeFileSync(f, 'function x( {\n');
    setVerifyEnabled(true);
    expect(await verifyHook('EditFileTool', { path: f }, 'Edit to broken.js rejected by user.', { cwd: dir })).toBeUndefined();
  });
});

describe('buildTool augments result with verify diagnostics (B2 integration)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-verifyint-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appends the verify warning onto the edit tool result', async () => {
    const f = path.join(dir, 'broken.js');
    fs.writeFileSync(f, 'function x( {\n');
    setVerifyEnabled(true);
    registerPostHook(['FakeEdit'], verifyHook);
    const tool = buildTool({ name: 'FakeEdit', description: '', schema: {}, isDestructive: false, execute: async () => 'Edited broken.js' }, governor);
    const res = await tool.execute({ path: f }, { cwd: dir });
    expect(res).toMatch(/Edited broken\.js/);
    expect(res).toMatch(/Auto-verify failed/);
  });
});
