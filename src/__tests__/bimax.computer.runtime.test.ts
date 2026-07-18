jest.mock('../mcp/client', () => ({ openClient: jest.fn() }));

import { openClient } from '../mcp/client';
import { BimaxComputerRuntime } from '../computer/desktop.runtime';

function result(structuredContent: any, text = '') {
  return { structuredContent, content: text ? [{ type: 'text', text }] : [], isError: false };
}

describe('BimaxComputerRuntime', () => {
  const callTool = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BIMAX_COMPUTER_USE_DRIVER = process.execPath;
    (openClient as jest.Mock).mockResolvedValue({ callTool, close: jest.fn() });
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({
        name: 'Calculator', pid: 42, windows: [{ window_id: 7, title: 'Calculator' }],
      });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/bimax-window.png', screenshot_width: 500, screenshot_height: 700,
        tree_markdown: '[3] AXStaticText value="216,174"',
        elements: [{ element_index: 3, element_token: 'fresh-token', role: 'AXStaticText', label: 'Result', value: '216,174' }],
      }, 'Cua Driver observation');
      if (name === 'type_text') return result({ effect: 'delivered' });
      if (name === 'hotkey') return result({ effect: 'unverifiable' });
      if (name === 'list_windows') return result({ windows: [] });
      return result({ ok: true });
    });
  });

  afterEach(() => { delete process.env.BIMAX_COMPUTER_USE_DRIVER; });

  it('keeps one native session and carries pid/window identity through observe and actions', async () => {
    const runtime = new BimaxComputerRuntime();
    const opened = await runtime.run({ action: 'open', app: 'Calculator' });
    expect(opened).toEqual(expect.objectContaining({ ok: true, app: 'Calculator', pid: 42, windowId: 7 }));

    const observed = await runtime.run({ action: 'observe' });
    expect(observed).toEqual(expect.objectContaining({
      ok: true, pid: 42, windowId: 7, screenshot: '/tmp/bimax-window.png',
      tree: expect.stringContaining('216,174'),
    }));
    expect(runtime.describeTarget({ action: 'click', elementToken: 'fresh-token' }))
      .toEqual(expect.objectContaining({ label: 'Result', value: '216,174' }));

    await runtime.run({ action: 'type', text: '1271*170+104' });
    const typeCall = callTool.mock.calls.find(([arg]) => arg.name === 'type_text')?.[0];
    expect(typeCall.arguments).toEqual(expect.objectContaining({ pid: 42, window_id: 7, text: '1271*170+104' }));
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'start_session')).toHaveLength(1);
  });

  it('cooperatively closes and verifies the target window disappeared', async () => {
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' });
    const closed = await runtime.run({ action: 'close' });
    expect(closed.ok).toBe(true);
    expect(closed.summary).toContain('verified');
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'hotkey' }));
    expect(callTool).toHaveBeenCalledWith({ name: 'list_windows', arguments: { pid: 42 } });
  });

  it('never exposes the upstream product name in model-visible failures', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'health_report') return {
        isError: true, structuredContent: {}, content: [{ type: 'text', text: 'cua-driver failed' }],
      };
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    const status = await runtime.run({ action: 'status' });
    expect(status.ok).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/cua/i);
    expect(status.error).toContain('Bimax Computer Use');
  });
});
