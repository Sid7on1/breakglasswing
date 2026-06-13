import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { createGrepTool, createGlobTool } from '../tools/implementations/search.tool';
import { createTodoWriteTool } from '../tools/implementations/todo.tool';
import { IGovernor } from '../core/interfaces';

// Governor stub: approve everything so we exercise the tool logic itself.
const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-tools-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('EditFileTool', () => {
  const tool = createEditFileTool(governor);

  it('replaces a unique exact string', async () => {
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'hello world\ngoodbye world\n');
    const res = await tool.execute({ path: file, oldString: 'hello world', newString: 'hi world' }, { cwd: dir });
    expect(res).toContain('Edited');
    expect(await fs.readFile(file, 'utf8')).toBe('hi world\ngoodbye world\n');
  });

  it('rejects ambiguous matches unless replaceAll', async () => {
    const file = path.join(dir, 'b.txt');
    await fs.writeFile(file, 'dup\ndup\n');
    const res = await tool.execute({ path: file, oldString: 'dup', newString: 'uniq' }, { cwd: dir });
    expect(res).toContain('appears 2 times');

    const all = await tool.execute({ path: file, oldString: 'dup', newString: 'uniq', replaceAll: true }, { cwd: dir });
    expect(all).toContain('2 replacements');
    expect(await fs.readFile(file, 'utf8')).toBe('uniq\nuniq\n');
  });

  it('errors cleanly on missing file and missing match', async () => {
    const missing = await tool.execute({ path: path.join(dir, 'nope.txt'), oldString: 'x', newString: 'y' }, { cwd: dir });
    expect(missing).toContain('File not found');

    const file = path.join(dir, 'c.txt');
    await fs.writeFile(file, 'content');
    const noMatch = await tool.execute({ path: file, oldString: 'absent', newString: 'y' }, { cwd: dir });
    expect(noMatch).toContain('not found in');
  });

  it('rejects identical oldString and newString', async () => {
    const res = await tool.execute({ path: 'whatever.txt', oldString: 'same', newString: 'same' }, { cwd: dir });
    expect(res).toContain('must be different');
  });
});

describe('GrepTool', () => {
  const tool = createGrepTool(governor);

  beforeEach(async () => {
    await fs.writeFile(path.join(dir, 'one.ts'), 'export function alpha() {}\nconst beta = 1;\n');
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'two.ts'), 'alpha();\nalpha();\n');
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.writeFile(path.join(dir, 'node_modules', 'ignored.ts'), 'alpha everywhere');
  });

  it('finds matching lines with line numbers', async () => {
    const res = await tool.execute({ pattern: 'alpha', path: dir }, { cwd: dir });
    expect(res).toContain('one.ts:1:');
    expect(res).toContain('two.ts');
    expect(res).not.toContain('node_modules');
  });

  it('supports files and count output modes', async () => {
    const files = await tool.execute({ pattern: 'alpha', path: dir, outputMode: 'files' }, { cwd: dir });
    expect(files).toContain('2 file(s) matched');

    const count = await tool.execute({ pattern: 'alpha', path: dir, outputMode: 'count' }, { cwd: dir });
    expect(count).toContain('2\t');
  });

  it('filters with a glob and reports invalid regex', async () => {
    await fs.writeFile(path.join(dir, 'notes.md'), 'alpha note');
    const res = await tool.execute({ pattern: 'alpha', path: dir, glob: '**/*.md' }, { cwd: dir });
    expect(res).toContain('notes.md');
    expect(res).not.toContain('one.ts');

    const bad = await tool.execute({ pattern: '([', path: dir }, { cwd: dir });
    expect(bad).toContain('invalid regular expression');
  });
});

describe('GlobTool', () => {
  const tool = createGlobTool(governor);

  it('matches by pattern and excludes ignored dirs', async () => {
    await fs.writeFile(path.join(dir, 'x.ts'), '');
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, 'src', 'y.ts'), '');
    await fs.writeFile(path.join(dir, 'z.md'), '');
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.writeFile(path.join(dir, 'node_modules', 'dep.ts'), '');

    const res = await tool.execute({ pattern: '**/*.ts', path: dir }, { cwd: dir });
    expect(res).toContain('2 file(s) matched');
    expect(res).toContain('x.ts');
    expect(res).toContain(path.join('src', 'y.ts'));
    expect(res).not.toContain('node_modules');
  });

  it('reports when nothing matches', async () => {
    const res = await tool.execute({ pattern: '**/*.xyz', path: dir }, { cwd: dir });
    expect(res).toContain('No files matched');
  });
});

describe('TodoWriteTool', () => {
  const tool = createTodoWriteTool(governor);

  it('renders the checklist with progress', async () => {
    const res = await tool.execute({
      todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress' },
        { content: 'third', status: 'pending' },
      ],
    });
    expect(res).toContain('1/3 done');
    expect(res).toContain('[x] first');
    expect(res).toContain('[~] second');
    expect(res).toContain('[ ] third');
  });

  it('drops malformed entries', async () => {
    const res = await tool.execute({
      todos: [
        { content: 'ok', status: 'pending' },
        { content: '', status: 'pending' },
        { content: 'bad-status', status: 'wat' } as any,
      ],
    });
    expect(res).toContain('0/1 done');
    expect(res).not.toContain('bad-status');
  });
});
