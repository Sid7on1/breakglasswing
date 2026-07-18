import { appNamesMatch, scaleNormalizedPoint, DesktopRuntimePort, DesktopResult } from '../computer/desktop.runtime';
import { screenshotFromToolResult } from '../core/multimodal';
import { IGovernor } from '../core/interfaces';
import { createComputerTool } from '../tools/implementations/computer.tool';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

function fakeRuntime(overrides: Partial<DesktopResult> = {}): DesktopRuntimePort {
  return {
    run: jest.fn().mockImplementation(async (cmd: any): Promise<DesktopResult> => ({
      ok: true, action: cmd.action, driver: 'fake', app: cmd.app, summary: `${cmd.action} done`, ...overrides,
    })),
    quickStatus: jest.fn().mockReturnValue({ driver: 'fake', ready: true, accessibility: null, screenRecording: null }),
    frontmostApp: jest.fn().mockResolvedValue('Notes'),
  };
}

describe('ComputerTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps normalized 0–1000 coordinates to screen points, clamped', () => {
    expect(scaleNormalizedPoint(500, 1470)).toBe(735);
    expect(scaleNormalizedPoint(0, 1470)).toBe(0);
    expect(scaleNormalizedPoint(1000, 956)).toBe(956);
    expect(scaleNormalizedPoint(-50, 1470)).toBe(0);
    expect(scaleNormalizedPoint(2000, 1470)).toBe(1470);
  });

  it('compares app names without case or the .app suffix', () => {
    expect(appNamesMatch('Calculator', 'calculator.app')).toBe(true);
    expect(appNamesMatch('Terminal', 'Calculator')).toBe(false);
  });

  it('gates acting verbs with the frontmost app as the grant scope, leaves observation free', async () => {
    const runtime = fakeRuntime();
    const tool = createComputerTool(governor, runtime);

    const controlCalls = () => (governor.approveTaskExecution as jest.Mock).mock.calls.filter(call => call[0] === 'COMPUTER_CONTROL');
    await tool.execute({ action: 'screenshot' }, { cwd: process.cwd() });
    await tool.execute({ action: 'cursor' }, { cwd: process.cwd() });
    await tool.execute({ action: 'status' }, { cwd: process.cwd() });
    expect(controlCalls()).toHaveLength(0);

    await tool.execute({ action: 'click', x: 10, y: 20 }, { cwd: process.cwd() });
    expect(governor.approveTaskExecution).toHaveBeenCalledWith('COMPUTER_CONTROL', expect.objectContaining({
      tool: 'ComputerTool', action: 'click', app: 'Notes', isDestructive: true,
    }));
  });

  it('scopes the open action to the app being opened, not the current frontmost one', async () => {
    const tool = createComputerTool(governor, fakeRuntime());
    await tool.execute({ action: 'open', app: 'Calculator' }, { cwd: process.cwd() });
    expect(governor.approveTaskExecution).toHaveBeenCalledWith('COMPUTER_CONTROL', expect.objectContaining({
      action: 'open', app: 'Calculator',
    }));
  });

  it('locks later keyboard input and cleanup to the most recently opened app', async () => {
    const runtime = fakeRuntime();
    const tool = createComputerTool(governor, runtime);
    await tool.execute({ action: 'open', app: 'Calculator' }, { cwd: process.cwd() });
    await tool.execute({ action: 'type', text: '2+2' }, { cwd: process.cwd() });
    await tool.execute({ action: 'key', combo: 'return' }, { cwd: process.cwd() });
    await tool.execute({ action: 'close' }, { cwd: process.cwd() });

    const calls = (runtime.run as jest.Mock).mock.calls.map(([cmd]) => cmd);
    expect(calls.slice(1)).toEqual([
      expect.objectContaining({ action: 'type', app: 'Calculator' }),
      expect.objectContaining({ action: 'key', app: 'Calculator' }),
      expect.objectContaining({ action: 'close', app: 'Calculator' }),
    ]);
    const approvals = (governor.approveTaskExecution as jest.Mock).mock.calls
      .filter(([kind]) => kind === 'COMPUTER_CONTROL')
      .map(([, payload]) => payload);
    expect(approvals.every((payload: any) => payload.app === 'Calculator')).toBe(true);
  });

  it('flags high-impact intent (send/purchase/delete wording) so the governor always prompts', async () => {
    const tool = createComputerTool(governor, fakeRuntime());
    const controlCalls = () => (governor.approveTaskExecution as jest.Mock).mock.calls.filter(call => call[0] === 'COMPUTER_CONTROL');
    await tool.execute({ action: 'key', combo: 'cmd+return' }, { cwd: process.cwd() });
    expect(controlCalls()[0][1].highImpact).toBeUndefined();

    await tool.execute({ action: 'type', text: 'confirm purchase now' }, { cwd: process.cwd() });
    const payload = controlCalls()[1][1];
    expect(payload.highImpact).toBe(true);
    expect(payload.impactReason).toBeTruthy();
  });

  it('does not act when the governor vetoes', async () => {
    const veto = { approveTaskExecution: jest.fn().mockRejectedValue(new Error('vetoed')) } as unknown as IGovernor;
    const runtime = fakeRuntime();
    const tool = createComputerTool(veto, runtime);
    await expect(tool.execute({ action: 'click', x: 1, y: 1 }, { cwd: process.cwd() })).rejects.toThrow('vetoed');
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it('feeds screenshots into the vision observation loop via the shared extractor', async () => {
    const runtime = fakeRuntime({ screenshot: '/tmp/shot.png' });
    const tool = createComputerTool(governor, runtime);
    const output = await tool.execute({ action: 'screenshot' }, { cwd: process.cwd() });
    expect(screenshotFromToolResult('ComputerTool', output)).toBe('/tmp/shot.png');
    expect(screenshotFromToolResult('ReadTool', output)).toBeNull();
  });
});
