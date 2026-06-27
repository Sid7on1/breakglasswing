import { createBashTool } from '../tools/implementations/bash.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// Esc mid-turn aborts the signal threaded into the tool context; a long Bash command must be killed
// at once and surface as "interrupted", not run to completion / its timeout.
describe('BashTool — aborts on signal', () => {
  it('kills a long-running command immediately when its signal aborts', async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = createBashTool(governor).execute(
      { command: 'sleep 10', timeout: 30_000 },
      { cwd: process.cwd(), signal: ac.signal },
    );
    setTimeout(() => ac.abort(), 100); // user hits esc ~100ms in
    await expect(p).rejects.toThrow(/interrupted/i);
    expect(Date.now() - start).toBeLessThan(3000); // didn't wait out the 10s sleep / 30s timeout
  });
});
