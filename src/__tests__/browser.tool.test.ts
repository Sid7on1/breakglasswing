import { validateBrowserUrl, BrowserRuntimePort } from '../browser/browser.runtime';
import { cliEvents } from '../cli/events';
import { IGovernor } from '../core/interfaces';
import { OutcomeManager } from '../outcome/outcome.manager';
import { createBrowserTool } from '../tools/implementations/browser.tool';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

describe('BrowserTool', () => {
  it('allows localhost, rejects non-http URLs, and gates private networks explicitly', () => {
    expect(validateBrowserUrl('http://localhost:3000').ok).toBe(true);
    expect(validateBrowserUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateBrowserUrl('http://192.168.1.10').ok).toBe(false);
    expect(validateBrowserUrl('http://192.168.1.10', true).ok).toBe(true);
  });

  it('emits engine evidence for deterministic browser assertions', async () => {
    const runtime: BrowserRuntimePort = {
      close: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({
        ok: true, action: 'assert', url: 'http://localhost:3000', summary: '2/2 browser assertions passed.',
        consoleErrors: [], failedRequests: [], attempts: 1, durationMs: 5,
      }),
    };
    const tool = createBrowserTool(governor, runtime);
    const evidence = new Promise<any>(resolve => cliEvents.once('browser_evidence', resolve));
    const output = await tool.execute({ action: 'assert', assertion: { textIncludes: 'Ready' } }, { cwd: process.cwd() });
    expect(JSON.parse(output).ok).toBe(true);
    await expect(evidence).resolves.toMatchObject({ action: 'assert', ok: true, trusted: true });
  });

  it('lets deterministic assertions pass visual criteria while screenshots remain untrusted', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-outcome-'));
    try {
      const manager = new OutcomeManager({ sessionId: () => 'browser-test', directory: () => directory, silent: true });
      manager.syncSession();
      manager.define('Verify UI', [{ id: 'ui', description: 'UI works', verification: 'visual' }]);
      manager.onBrowserEvidence({ action: 'screenshot', ok: true, trusted: false, source: 'shot.png', summary: 'captured' });
      expect(manager.current()?.criteria[0].status).toBe('pending');
      manager.onBrowserEvidence({ action: 'assert', ok: true, trusted: true, source: 'http://localhost', summary: 'assertions passed' });
      expect(manager.current()?.criteria[0].status).toBe('passed');
      manager.shutdown();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
