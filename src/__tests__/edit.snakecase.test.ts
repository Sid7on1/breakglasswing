import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// Models trained on Claude Code emit snake_case keys (file_path / old_string / new_string). The tools
// must accept those as well as our camelCase schema — previously they arrived as undefined fields and
// failed with "edit #1 (undefined): newString must differ from oldString".
describe('edit tools accept snake_case (Claude-Code style) params', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-snake-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('EditFileTool applies a snake_case edit', async () => {
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'hello world', 'utf8');
    const res = await createEditFileTool(governor).execute(
      { file_path: file, old_string: 'hello world', new_string: 'hi world' } as any,
      { cwd: dir },
    );
    expect(String(res)).not.toMatch(/must differ|undefined/i);
    expect(await fs.readFile(file, 'utf8')).toBe('hi world');
  });

  it('MultiEditTool applies snake_case edits', async () => {
    const file = path.join(dir, 'b.txt');
    await fs.writeFile(file, 'alpha beta', 'utf8');
    const res = await createMultiEditTool(governor).execute(
      { edits: [{ file_path: file, old_string: 'alpha', new_string: 'ALPHA' }] } as any,
      { cwd: dir },
    );
    expect(String(res)).not.toMatch(/must differ|undefined/i);
    expect(await fs.readFile(file, 'utf8')).toBe('ALPHA beta');
  });
});
