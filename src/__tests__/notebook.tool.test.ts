import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNotebookEditTool } from '../tools/implementations/notebook.tool';

const governor: any = { approveTaskExecution: jest.fn().mockResolvedValue(undefined), mode: 'default' };
const tool = createNotebookEditTool(governor);

let dir: string;
let nbPath: string;
const run = (args: any) => tool.execute(args, { cwd: dir });
const readNb = () => JSON.parse(fs.readFileSync(nbPath, 'utf-8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  nbPath = path.join(dir, 'n.ipynb');
  fs.writeFileSync(nbPath, JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'intro'] },
      { cell_type: 'code', source: ['print(1)'], outputs: [{ text: 'stale' }], execution_count: 3 },
    ],
    metadata: { kernelspec: { name: 'python3' } },
    nbformat: 4, nbformat_minor: 5,
  }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('NotebookEditTool', () => {
  it('reads cells with index, type, and preview', async () => {
    const out = await run({ action: 'read', path: 'n.ipynb' });
    expect(out).toContain('2 cell(s)');
    expect(out).toContain('[0] markdown');
    expect(out).toContain('[1] code');
    expect(out).toContain('print(1)');
  });

  it('edits a cell and clears its stale outputs, preserving other cells + metadata', async () => {
    const out = await run({ action: 'edit', path: 'n.ipynb', cellIndex: 1, source: 'print(42)\nprint(43)' });
    expect(out).toContain('Edited cell [1]');
    const nb = readNb();
    expect(nb.cells[1].source).toEqual(['print(42)\n', 'print(43)']);
    expect(nb.cells[1].outputs).toEqual([]);          // stale outputs cleared
    expect(nb.cells[1].execution_count).toBeNull();
    expect(nb.cells[0].source).toEqual(['# Title\n', 'intro']); // other cell untouched
    expect(nb.metadata.kernelspec.name).toBe('python3');        // metadata preserved
  });

  it('inserts a cell at an index and appends when index omitted', async () => {
    await run({ action: 'insert', path: 'n.ipynb', cellIndex: 1, source: 'x = 1', cellType: 'code' });
    let nb = readNb();
    expect(nb.cells.length).toBe(3);
    expect(nb.cells[1].source).toEqual(['x = 1']);
    expect(nb.cells[1].outputs).toEqual([]);

    await run({ action: 'insert', path: 'n.ipynb', source: '## end', cellType: 'markdown' });
    nb = readNb();
    expect(nb.cells.length).toBe(4);
    expect(nb.cells[3].cell_type).toBe('markdown');
  });

  it('deletes a cell', async () => {
    const out = await run({ action: 'delete', path: 'n.ipynb', cellIndex: 0 });
    expect(out).toContain('Deleted markdown cell [0]');
    expect(readNb().cells.length).toBe(1);
  });

  it('errors on out-of-range index, missing file, and non-notebook JSON', async () => {
    expect(await run({ action: 'edit', path: 'n.ipynb', cellIndex: 9, source: 'x' })).toContain('valid cellIndex');
    expect(await run({ action: 'read', path: 'missing.ipynb' })).toContain('not found');
    fs.writeFileSync(path.join(dir, 'bad.ipynb'), '{"not":"a notebook"}');
    expect(await run({ action: 'read', path: 'bad.ipynb' })).toContain('no "cells" array');
  });
});
