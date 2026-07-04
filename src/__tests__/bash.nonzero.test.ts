import { createBashTool } from '../tools/implementations/bash.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// A non-zero exit is normal for useful commands (tsc with errors, failing tests, grep no-match). The
// tool must RETURN the captured output + exit code, not discard it as "Command failed" — otherwise
// the model can't see the errors and has to redirect to a temp file to read them.
describe('BashTool — non-zero exit returns output, not a bare failure', () => {
  it('returns stdout + exit code when a command exits non-zero with output', async () => {
    const res: any = await createBashTool(governor).execute(
      { command: 'echo "TYPE_ERROR_HERE"; exit 1' },
      { cwd: process.cwd() },
    );
    expect(String(res)).toContain('TYPE_ERROR_HERE');
    expect(String(res)).toMatch(/exited with code 1/);
  });

  it('captures stderr from a failing command (grep no match style)', async () => {
    const res: any = await createBashTool(governor).execute(
      { command: 'echo "to stderr" 1>&2; exit 2' },
      { cwd: process.cwd() },
    );
    expect(String(res)).toContain('to stderr');
    expect(String(res)).toMatch(/exited with code 2/);
  });
});
