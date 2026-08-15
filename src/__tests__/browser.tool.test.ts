import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateBrowserUrl, BrowserRuntimePort } from '../browser/browser.runtime';
import { cliEvents } from '../cli/events';
import { IGovernor } from '../core/interfaces';
import { OutcomeManager } from '../outcome/outcome.manager';
import { createBrowserTool } from '../tools/implementations/browser.tool';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

describe('BrowserTool', () => {
  beforeEach(() => jest.clearAllMocks());
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

  it('gates state-changing actions while leaving snapshots read-only', async () => {
    const runtime: BrowserRuntimePort = {
      close: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockImplementation(async (command: any) => ({
        ok: true, action: command.action, summary: 'ok', consoleErrors: [], failedRequests: [], attempts: 1, durationMs: 1,
      })),
    };
    const tool = createBrowserTool(governor, runtime);
    await tool.execute({ action: 'snapshot' }, { cwd: process.cwd() });
    expect(governor.approveTaskExecution).toHaveBeenCalledWith('TOOL_EXECUTION', expect.objectContaining({
      action: 'snapshot', isDestructive: false,
    }));
    await tool.execute({ action: 'click', elementIndex: 0 }, { cwd: process.cwd() });
    expect(governor.approveTaskExecution).toHaveBeenCalledWith('TOOL_EXECUTION', expect.objectContaining({ action: 'click', isDestructive: true }));
  });

  it('marks safely dismissed dialog inspection as read-only', async () => {
    const runtime: BrowserRuntimePort = {
      close: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockImplementation(async (command: any) => ({
        ok: true, action: command.action, summary: 'ok', consoleErrors: [], failedRequests: [],
        attempts: 1, durationMs: 1,
      })),
    };
    const tool = createBrowserTool(governor, runtime);
    await tool.execute({ action: 'dialogs' }, { cwd: process.cwd() });
    expect(governor.approveTaskExecution).toHaveBeenCalledWith('TOOL_EXECUTION', expect.objectContaining({
      action: 'dialogs', isDestructive: false,
    }));
  });

  it('requires a workspace-scoped FILE_WRITE decision before arming one download', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-download-tool-'));
    try {
      const runtime: BrowserRuntimePort = {
        close: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockImplementation(async (command: any) => ({
          ok: true, action: command.action, summary: 'armed', consoleErrors: [], failedRequests: [],
          attempts: 1, durationMs: 1,
        })),
      };
      const tool = createBrowserTool(governor, runtime);
      const result = JSON.parse(await tool.execute({
        action: 'download_prepare', path: 'downloads', maxBytes: 4096,
      }, { cwd: directory }));
      expect(result.ok).toBe(true);
      expect(governor.approveTaskExecution).toHaveBeenCalledWith('FILE_WRITE', expect.objectContaining({
        action: 'download_prepare', targetPath: path.join(directory, 'downloads'), maxBytes: 4096,
      }));
      expect(runtime.run).toHaveBeenCalled();

      jest.clearAllMocks();
      const refused = JSON.parse(await tool.execute({
        action: 'download_prepare', path: '../escape',
      }, { cwd: directory }));
      expect(refused).toMatchObject({ ok: false, summary: expect.stringMatching(/inside the active workspace/) });
      expect((governor.approveTaskExecution as jest.Mock).mock.calls
        .some(([type]) => type === 'FILE_WRITE')).toBe(false);
      expect(runtime.run).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
