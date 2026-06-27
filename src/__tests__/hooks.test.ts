import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  registerPreHook, registerPostHook, runPreHooks, runPostHooks, clearHooks, hookCounts,
} from '../tools/hooks';
import { loadHooksConfig } from '../tools/hooks.loader';
import { buildTool } from '../tools/tool.factory';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

afterEach(() => clearHooks());

describe('hook registry (A2)', () => {
  it('a PreToolUse hook can block; non-matching tools are unaffected', async () => {
    registerPreHook('BashTool', () => ({ block: true, reason: 'no shell' }));
    expect(await runPreHooks('BashTool', {}, {})).toEqual({ block: true, reason: 'no shell' });
    expect(await runPreHooks('ReadFileTool', {}, {})).toBeUndefined();
  });

  it('glob patterns match tool names', async () => {
    const seen: string[] = [];
    registerPreHook('Edit*', (name) => { seen.push(name); });
    await runPreHooks('EditFileTool', {}, {});
    await runPreHooks('ReadFileTool', {}, {});
    expect(seen).toEqual(['EditFileTool']);
  });

  it('a throwing hook is non-fatal', async () => {
    registerPreHook('*', () => { throw new Error('boom'); });
    await expect(runPreHooks('AnyTool', {}, {})).resolves.toBeUndefined();
  });

  it('PostToolUse hooks observe the result', async () => {
    let captured: any;
    registerPostHook('*', (_n, _a, result) => { captured = result; });
    await runPostHooks('ReadFileTool', {}, 'file contents', {});
    expect(captured).toBe('file contents');
  });
});

describe('buildTool × hooks (A2 integration)', () => {
  it('a blocking Pre hook prevents execute and returns a blocked message', async () => {
    const exec = jest.fn().mockResolvedValue('ran');
    const tool = buildTool({ name: 'DangerTool', description: '', schema: {}, isDestructive: false, execute: exec }, governor);
    registerPreHook('DangerTool', () => ({ block: true, reason: 'policy' }));
    const res = await tool.execute({}, {});
    expect(res).toMatch(/blocked before running: policy/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('Post hook sees the tool result on success', async () => {
    const tool = buildTool({ name: 'OkTool', description: '', schema: {}, isDestructive: false, execute: async () => 'done' }, governor);
    let seen: any;
    registerPostHook('OkTool', (_n, _a, result) => { seen = result; });
    const res = await tool.execute({}, {});
    expect(res).toBe('done');
    expect(seen).toBe('done');
  });
});

describe('loadHooksConfig (A2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-hooks-'));
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('registers pre/post shell hooks from .bimax/hooks.json', () => {
    fs.writeFileSync(path.join(dir, '.bimax', 'hooks.json'), JSON.stringify({
      preToolUse: [{ match: 'BashTool', command: 'exit 1' }],
      postToolUse: [{ match: '*', command: 'true' }],
    }));
    const n = loadHooksConfig(dir);
    expect(n).toBe(2);
    expect(hookCounts()).toEqual({ pre: 1, post: 1 });
  });

  it('a Pre shell hook that exits non-zero blocks the tool', async () => {
    fs.writeFileSync(path.join(dir, '.bimax', 'hooks.json'), JSON.stringify({
      preToolUse: [{ match: 'BashTool', command: 'echo nope 1>&2; exit 3' }],
    }));
    loadHooksConfig(dir);
    const r = await runPreHooks('BashTool', { command: 'ls' }, {});
    expect(r && r.block).toBe(true);
    expect(r && r.reason).toMatch(/nope/);
  });

  it('missing config registers nothing', () => {
    expect(loadHooksConfig(dir)).toBe(0);
  });
});
