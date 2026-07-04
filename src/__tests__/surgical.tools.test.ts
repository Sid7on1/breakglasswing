import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectSymbols, createSymbolEditTool } from '../tools/implementations/symboledit.tool';
import { detectRunner } from '../tools/implementations/relatedtests.tool';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { shieldEdit } from '../tools/syntax.check';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

const SAMPLE = `/** Adds. */
export function add(a: number, b: number): number {
  return a + b;
}

export const LIMIT = 10;

export class Calc {
  private total = 0;

  /** Accumulate. */
  push(n: number): void {
    this.total += n;
  }

  get value(): number {
    return this.total;
  }
}
`;

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-surgical-'));
  file = path.join(dir, 'sample.ts');
  fs.writeFileSync(file, SAMPLE);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('collectSymbols', () => {
  it('finds top-level declarations and class members with Class.member addressing', () => {
    const names = collectSymbols(file, SAMPLE).map(s => `${s.name}:${s.kind}`);
    expect(names).toEqual(expect.arrayContaining([
      'add:function', 'LIMIT:variable', 'Calc:class', 'Calc.push:method', 'Calc.value:getter', 'Calc.total:property',
    ]));
  });
});

describe('SymbolEditTool', () => {
  const tool = createSymbolEditTool(governor);

  it('replaces a whole function (JSDoc included) without string matching', async () => {
    const res = await tool.execute({
      path: file, symbol: 'add', action: 'replace',
      newCode: '/** Multiplies now. */\nexport function add(a: number, b: number): number {\n  return a * b;\n}',
    }, { cwd: dir });
    expect(res).toContain("replace function 'add'");
    const updated = fs.readFileSync(file, 'utf8');
    expect(updated).toContain('a * b');
    expect(updated).not.toContain('/** Adds. */'); // the old JSDoc went with the old declaration
    expect(updated).toContain('export const LIMIT = 10;'); // neighbours untouched
  });

  it('edits a class method addressed as Class.member, preserving indentation', async () => {
    await tool.execute({
      path: file, symbol: 'Calc.push', action: 'replace',
      newCode: '/** Accumulate twice. */\npush(n: number): void {\n  this.total += n * 2;\n}',
    }, { cwd: dir });
    const updated = fs.readFileSync(file, 'utf8');
    expect(updated).toContain('this.total += n * 2;');
    expect(updated).toMatch(/^ {2}push\(n: number\): void \{/m); // re-indented to class-body depth
  });

  it('deletes a symbol cleanly', async () => {
    const res = await tool.execute({ path: file, symbol: 'LIMIT', action: 'delete' }, { cwd: dir });
    expect(res).toContain("delete variable 'LIMIT'");
    expect(fs.readFileSync(file, 'utf8')).not.toContain('LIMIT');
  });

  it('lists the addressable symbols when the target is missing', async () => {
    const res = await tool.execute({ path: file, symbol: 'nope', action: 'delete' }, { cwd: dir });
    expect(res).toContain("no symbol named 'nope'");
    expect(res).toContain('add (function');
    expect(res).toContain('Calc.push (method');
  });

  it('refuses a replacement that would break the file (Edit Shield)', async () => {
    const res = await tool.execute({
      path: file, symbol: 'add', action: 'replace',
      newCode: 'export function add(a: number { return a; }', // missing paren
    }, { cwd: dir });
    expect(res).toContain('Edit Shield');
    expect(fs.readFileSync(file, 'utf8')).toContain('return a + b;'); // untouched
  });
});

describe('Edit Shield (shieldEdit + EditFileTool integration)', () => {
  it('rejects content that introduces syntax errors and allows clean content', () => {
    expect(shieldEdit(file, SAMPLE, SAMPLE.replace('return a + b;', 'return a + ;'))).toContain('INTRODUCE');
    expect(shieldEdit(file, SAMPLE, SAMPLE.replace('a + b', 'a - b'))).toBeNull();
  });

  it('does not block edits to an already-broken file that keep the error count flat', () => {
    const broken = 'function x( {'; // 1+ errors already
    expect(shieldEdit(file, broken, broken + '\n// note')).toBeNull();
  });

  it('can be disabled with BIMAX_EDIT_SHIELD=0', () => {
    process.env.BIMAX_EDIT_SHIELD = '0';
    try {
      expect(shieldEdit(file, SAMPLE, 'utterly ((( broken')).toBeNull();
    } finally {
      delete process.env.BIMAX_EDIT_SHIELD;
    }
  });

  it('EditFileTool refuses an edit that would break syntax, before touching disk', async () => {
    const edit = createEditFileTool(governor);
    const res = await edit.execute({
      path: file, oldString: 'return a + b;', newString: 'return (a + b;',
    }, { cwd: dir });
    expect(res).toContain('Edit Shield');
    expect(fs.readFileSync(file, 'utf8')).toContain('return a + b;');
  });
});

describe('detectRunner', () => {
  it('detects jest from the nearest package.json (this repo)', () => {
    const runner = detectRunner(path.join(process.cwd(), 'src', 'index.ts'));
    expect(runner?.kind).toBe('jest');
  });

  it('routes .go files to go test', () => {
    expect(detectRunner('/anywhere/pkg/main.go')).toEqual({ kind: 'go', root: '/anywhere/pkg' });
  });

  it('returns null outside any package', () => {
    const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-nopkg-'));
    try {
      expect(detectRunner(path.join(lone, 'x.ts'))).toBeNull();
    } finally {
      fs.rmSync(lone, { recursive: true, force: true });
    }
  });
});
