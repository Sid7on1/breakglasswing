import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { checkEditSyntax } from '../tools/syntax.check';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

describe('checkEditSyntax', () => {
  it('passes clean code, flags an orphaned brace, ignores non-code', () => {
    expect(checkEditSyntax('a.ts', 'export const x = 1;')).toBeNull();
    expect(checkEditSyntax('a.tsx', 'export const C = () => <div/>;')).toBeNull();
    expect(checkEditSyntax('a.ts', 'function f(){ return 1; } }')).toMatch(/SYNTAX CHECK FAILED/);
    expect(checkEditSyntax('README.md', 'broken } {')).toBeNull();
  });

  it('EditFileTool appends a syntax warning when an edit breaks the file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-syn-'));
    const file = path.join(dir, 'a.ts');
    await fs.writeFile(file, 'export function f() { return 1; }', 'utf8');
    const res = String(await createEditFileTool(governor).execute(
      { path: file, oldString: 'return 1; }', newString: 'return 1; } }' }, { cwd: dir },
    ));
    expect(res).toMatch(/SYNTAX CHECK FAILED/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
