import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// Regression: String.prototype.replace interprets `$$`, `$&`, `` $` `` and `$'` in a STRING
// replacement even when the search pattern is a plain string. A newString carrying those (Makefiles,
// shell `$$`/PID, sed/regex code) used to be silently corrupted on write. The tools now use a
// replacer FUNCTION, so the replacement text lands verbatim.
describe('edit tools insert $-bearing replacement text verbatim (no $-pattern expansion)', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-dollar-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('EditFileTool: $$ stays $$ (not collapsed to $)', async () => {
    const file = path.join(dir, 'Makefile');
    await fs.writeFile(file, 'target:\n\techo PLACEHOLDER\n', 'utf8');
    await createEditFileTool(governor).execute(
      { file_path: file, old_string: 'PLACEHOLDER', new_string: 'price is $$5 and $& and $`' } as any,
      { cwd: dir },
    );
    expect(await fs.readFile(file, 'utf8')).toBe('target:\n\techo price is $$5 and $& and $`\n');
  });

  it('MultiEditTool: $-sequences are inserted literally', async () => {
    const file = path.join(dir, 'script.sh');
    await fs.writeFile(file, 'echo OLD\n', 'utf8');
    await createMultiEditTool(governor).execute(
      { edits: [{ file_path: file, old_string: 'OLD', new_string: 'pid=$$ arg=$1 whole=$&' }] } as any,
      { cwd: dir },
    );
    expect(await fs.readFile(file, 'utf8')).toBe('echo pid=$$ arg=$1 whole=$&\n');
  });
});
