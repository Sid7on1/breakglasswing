import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// Regression: a write that fails mid-batch must leave NO file changed (the tool promises atomicity).
// Earlier code wrote files one by one and only addressed the failed file, so files written before it
// stayed corrupted. We force the second file's write to fail (read-only) and assert the first reverts.
describe('MultiEditTool — all-or-nothing rollback on a mid-batch write failure', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-multiedit-')); });
  afterEach(async () => { await fs.chmod(path.join(dir, 'b.txt'), 0o644).catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });

  it('restores an already-written file when a later write fails', async () => {
    if (process.getuid && process.getuid() === 0) return; // root ignores the read-only bit; skip
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    await fs.writeFile(a, 'alpha original', 'utf8');
    await fs.writeFile(b, 'beta original', 'utf8');
    await fs.chmod(b, 0o444); // readable (Phase 1 validation) but not writable (Phase 3 fails)

    const tool = createMultiEditTool(governor);
    const res: any = await tool.execute({
      edits: [
        { path: a, oldString: 'alpha original', newString: 'alpha NEW' },
        { path: b, oldString: 'beta original', newString: 'beta NEW' },
      ],
    }, { cwd: dir });

    expect(String(res)).toMatch(/failed writing/i);
    expect(String(res)).toMatch(/[Rr]olled back/);
    // The first file must be back to its original content — not the half-applied "alpha NEW".
    expect(await fs.readFile(a, 'utf8')).toBe('alpha original');
  });
});
