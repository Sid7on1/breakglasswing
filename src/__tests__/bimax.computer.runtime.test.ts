jest.mock('../mcp/client', () => ({ openClient: jest.fn() }));

import { openClient } from '../mcp/client';
import { BimaxComputerRuntime, pngDimensionsFromBytes } from '../computer/desktop.runtime';
import { __resetConfigForTests } from '../cli/config';
import { LivePipPort } from '../computer/pip';

function result(structuredContent: any, text = '') {
  return { structuredContent, content: text ? [{ type: 'text', text }] : [], isError: false };
}

describe('BimaxComputerRuntime', () => {
  const callTool = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BIMAX_COMPUTER_USE_DRIVER = process.execPath;
    process.env.BIMAX_COMPUTER_RECORD = '0';
    process.env.BIMAX_COMPUTER_PIP = '0';
    __resetConfigForTests();
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
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'start_recording') return result({ enabled: true });
      if (name === 'get_recording_state') return result({ enabled: true, output_dir: '/tmp/recording' });
      if (name === 'stop_recording') return result({ enabled: false, last_video_path: '/tmp/recording/recording.mp4' });
      if (name === 'hotkey') return result({ effect: 'unverifiable' });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 500, height: 700 } }] });
      return result({ ok: true });
    });
  });

  afterEach(() => {
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
    delete process.env.BIMAX_COMPUTER_RECORD;
    delete process.env.BIMAX_COMPUTER_PIP;
    __resetConfigForTests();
  });

  it('uses real PNG pixels when Retina metadata reports logical points', () => {
    const pngHeader = Buffer.alloc(24);
    pngHeader.write('IHDR', 12, 'ascii');
    pngHeader.writeUInt32BE(1317, 16);
    pngHeader.writeUInt32BE(1568, 20);
    expect(pngDimensionsFromBytes(pngHeader)).toEqual({ width: 1317, height: 1568 });
  });

  it('keeps one native session and carries pid/window identity through observe and actions', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} delivered`,
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Calculator',
    };
    const runtime = new BimaxComputerRuntime(native);
    const opened = await runtime.run({ action: 'open', app: 'Calculator', deliveryMode: 'foreground' });
    expect(opened).toEqual(expect.objectContaining({ ok: true, app: 'Calculator', pid: 42, windowId: 7 }));
    expect(callTool).toHaveBeenCalledWith({ name: 'bring_to_front', arguments: { pid: 42, window_id: 7 } });

    const observed = await runtime.run({ action: 'observe' });
    expect(observed).toEqual(expect.objectContaining({
      ok: true, pid: 42, windowId: 7, screenshot: '/tmp/bimax-window.png',
      tree: expect.stringContaining('216,174'),
    }));
    expect(runtime.describeTarget({ action: 'click', elementToken: 'fresh-token' }))
      .toEqual(expect.objectContaining({ label: 'Result', value: '216,174' }));
    const observeCall = callTool.mock.calls.find(([arg]) => arg.name === 'get_window_state')?.[0];
    expect(observeCall.arguments.max_elements).toBe(1000);

    await runtime.run({ action: 'type', text: '1271*170+104', deliveryMode: 'foreground' });
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'type', app: 'Calculator', text: '1271*170+104',
    }), undefined);
    expect(callTool.mock.calls.some(([arg]) => arg.name === 'type_text')).toBe(false);
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'start_session')).toHaveLength(1);
    expect(callTool).toHaveBeenCalledWith({
      name: 'set_agent_cursor_enabled',
      arguments: { enabled: false, cursor_id: expect.stringMatching(/^bimax-/) },
    });
    expect((openClient as jest.Mock).mock.calls[0][0].args).not.toContain('--experimental-pip');
  });

  it('never starts recording from ordinary open/observe/type — record_start is the only path', async () => {
    // Even with recording ENABLED in config, ordinary actions must not begin a recording.
    process.env.BIMAX_COMPUTER_RECORD = '1';
    __resetConfigForTests();
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    await runtime.run({ action: 'type', text: '2+2', deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(callTool.mock.calls.some(([a]) => a.name === 'start_recording')).toBe(false);

    // Explicit record_start (window-scoped after open) is the one path that records.
    const rec = await runtime.run({ action: 'record_start' }, { cwd: '/tmp' });
    expect(rec.ok).toBe(true);
    const start = callTool.mock.calls.find(([arg]) => arg.name === 'start_recording')?.[0];
    expect(start.arguments).toEqual(expect.objectContaining({ record_video: true }));
    expect(start.arguments.output_dir).toMatch(/\/tmp\/\.bimax\/computer\/recordings\/run-/);

    const status = await runtime.run({ action: 'record_status' }, { cwd: '/tmp' });
    expect(status.recording).toEqual(expect.objectContaining({ enabled: true, outputDir: '/tmp/recording' }));
    const stopped = await runtime.run({ action: 'record_stop' }, { cwd: '/tmp' });
    expect(stopped.recording?.videoPath).toBe('/tmp/recording/recording.mp4');
  });

  it('refuses record_start entirely when recording is not opted in (default)', async () => {
    // beforeEach sets BIMAX_COMPUTER_RECORD=0 — the shipped default is also false.
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    const rec = await runtime.run({ action: 'record_start' }, { cwd: '/tmp' });
    expect(rec.ok).toBe(false);
    expect(rec.error).toMatch(/opt-in/);
    expect(callTool.mock.calls.some(([a]) => a.name === 'start_recording')).toBe(false);
  });

  it('refuses whole-display video without explicit approval; scopes to the agent window when one exists', async () => {
    process.env.BIMAX_COMPUTER_RECORD = '1';
    __resetConfigForTests();
    // No window yet → whole-display video is REFUSED without explicit approval.
    const wide = new BimaxComputerRuntime();
    const refused = await wide.run({ action: 'record_start' }, { cwd: '/tmp' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/whole-display/i);
    expect(callTool.mock.calls.some(([a]) => a.name === 'start_recording')).toBe(false);

    // A model-controlled boolean (the legacy field) can NEVER authorize whole-display capture …
    const forgedBool = await wide.run({ action: 'record_start', approveFullDisplay: true } as any, { cwd: '/tmp' });
    expect(forgedBool.ok).toBe(false);
    expect(forgedBool.error).toMatch(/whole-display/i);
    // … and neither can a guessed/forged token.
    const forgedToken = await wide.run({ action: 'record_start', fullDisplayToken: 'forged-token' }, { cwd: '/tmp' });
    expect(forgedToken.ok).toBe(false);
    expect(callTool.mock.calls.some(([a]) => a.name === 'start_recording')).toBe(false);

    // Only a governor-issued token (minted by the approval layer AFTER the user approved the
    // whole-display scope) authorizes it — and it is single-use.
    const token = wide.authorizeFullDisplayRecording();
    const approved = await wide.run({ action: 'record_start', fullDisplayToken: token }, { cwd: '/tmp' });
    expect(approved.ok).toBe(true);
    expect(approved.recording?.captureSafe).toBe(false);
    expect(approved.recording?.scope).toBe('whole display');
    expect(await wide.pipStatus()).toEqual(expect.objectContaining({ captureSafe: false }));
    // The consumed token cannot be replayed by a second runtime request.
    const replayTarget = new BimaxComputerRuntime();
    const replay = await replayTarget.run({ action: 'record_start', fullDisplayToken: token }, { cwd: '/tmp' });
    expect(replay.ok).toBe(false);

    // With a live agent window, recording + PiP scope to that capture-safe surface only —
    // no whole-display approval needed.
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator', deliveryMode: 'foreground' }, { cwd: '/tmp' });
    const scoped = await runtime.run({ action: 'record_start' }, { cwd: '/tmp' });
    expect(scoped.recording?.captureSafe).toBe(true);
    expect(scoped.recording?.scope).toContain('window 7');
    const startCall = callTool.mock.calls.filter(([a]) => a.name === 'start_recording').pop()?.[0];
    expect(startCall.arguments).toEqual(expect.objectContaining({ pid: 42, window_id: 7 }));
    expect(await runtime.pipStatus()).toEqual(expect.objectContaining({ captureSafe: true, surface: expect.stringContaining('window 7') }));
  });

  it('ends the native session at a turn boundary so PiP cannot linger', async () => {
    const close = jest.fn();
    (openClient as jest.Mock).mockResolvedValue({ callTool, close });
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' });
    await runtime.dispose();
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'end_session' }));
    expect(close).toHaveBeenCalledTimes(1);

    await runtime.run({ action: 'status' });
    expect(openClient).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'start_session')).toHaveLength(2);
  });

  it('streams the active target continuously, suspends for takeover, resumes, and stops on dispose', async () => {
    process.env.BIMAX_COMPUTER_PIP = '1';
    __resetConfigForTests();
    const sync = jest.fn();
    const stop = jest.fn(async () => undefined);
    const pip: LivePipPort = {
      sync,
      stop,
      status: () => ({
        enabled: true,
        running: true,
        continuous: true,
        captureSafe: true,
        surface: 'Calculator window 7',
      }),
    };
    const native: any = {
      run: jest.fn(async (cmd: any) => ({
        ok: true, action: cmd.action, driver: 'native-helper',
        app: cmd.app || 'Calculator', x: cmd.x, y: cmd.y, summary: `${cmd.action} done`,
      })),
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Calculator',
    };
    const runtime = new BimaxComputerRuntime(native, pip);

    await runtime.run({ action: 'open', app: 'Calculator', deliveryMode: 'foreground' });
    await new Promise(resolve => setImmediate(resolve));
    expect(sync).toHaveBeenLastCalledWith(
      { pid: 42, windowId: 7, label: 'Calculator window 7' },
      true,
    );
    expect(await runtime.pipStatus()).toEqual(expect.objectContaining({
      enabled: true, running: true, continuous: true, captureSafe: true,
    }));

    runtime.pauseForUser();
    await new Promise(resolve => setImmediate(resolve));
    expect(sync).toHaveBeenLastCalledWith(null, true);

    runtime.resume();
    await new Promise(resolve => setImmediate(resolve));
    expect(sync).toHaveBeenLastCalledWith(
      { pid: 42, windowId: 7, label: 'Calculator window 7' },
      true,
    );

    await runtime.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('pins actions to the freshly opened window and ignores stale model-repeated ids', async () => {
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' });

    const observed = await runtime.run({
      action: 'observe', app: 'Calculator', pid: 999, windowId: 5142, query: '216,174',
    });
    expect(observed).toEqual(expect.objectContaining({
      ok: true, pid: 42, windowId: 7,
      verification: { query: '216,174', matched: true, matchCount: 1 },
    }));
    const observeCall = callTool.mock.calls.find(([arg]) => arg.name === 'get_window_state')?.[0];
    expect(observeCall.arguments).toEqual(expect.objectContaining({ pid: 42, window_id: 7 }));

    await runtime.run({
      action: 'click', app: 'Calculator', pid: 999, windowId: 5142,
      x: 250, y: 300, deliveryMode: 'background', pixelFallback: true,
    });
    const clickCall = callTool.mock.calls.find(([arg]) => arg.name === 'click')?.[0];
    expect(clickCall.arguments).toEqual(expect.objectContaining({
      pid: 42, window_id: 7, x: 250, y: 300, delivery_mode: 'background',
    }));
    expect(callTool.mock.calls.some(([arg]) => arg.name === 'move_cursor')).toBe(false);
  });

  it('accepts fresh screenshot pixels and maps a visible label to its frame center', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 700, screenshot_height: 800,
        tree_markdown: 'Storage',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 0, y: 0, w: 700, h: 800 } },
          { element_index: 80, element_token: 'storage-token', role: 'AXButton', label: 'Storage', frame: { x: 10, y: 20, w: 100, h: 40 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });

    const guessed = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
    expect(guessed).toEqual(expect.objectContaining({ ok: true, screenshot: '/tmp/settings.png' }));
    const clicked = await runtime.run({ action: 'click', query: 'Storage', deliveryMode: 'background' });
    expect(clicked).toEqual(expect.objectContaining({ ok: true, summary: expect.stringContaining('Storage') }));
    const calls = callTool.mock.calls.filter(([arg]) => arg.name === 'click').map(([arg]) => arg.arguments);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.objectContaining({ pid: 42, window_id: 7, x: 100, y: 100 }));
    expect(calls[1]).toEqual(expect.objectContaining({ pid: 42, window_id: 7, x: 60, y: 40 }));
  });

  it('maps a captured label frame into model-visible screenshot pixels', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 350, height: 400 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 700, screenshot_height: 800,
        tree_markdown: 'General',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 100, y: 50, w: 350, h: 400 } },
          { element_index: 10, element_token: 'general', role: 'AXStaticText', label: 'General', frame: { x: 150, y: 100, w: 100, h: 40 } },
        ],
      });
      if (name === 'click') {
        return result({ effect: 'delivered' });
      }
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    const opened = await runtime.run({ action: 'open', app: 'System Settings' });
    expect(opened.coordinateSpace).toEqual({
      xY: 'screenshot_pixels', elementFrames: 'screenshot_pixels', normalized: '0-1000',
    });
    expect(opened.completionGuidance).toMatch(/categorical.*not a percentage/i);
    const observed = await runtime.run({ action: 'observe' });
    expect(observed.coordinateSpace).toEqual({
      xY: 'screenshot_pixels', elementFrames: 'screenshot_pixels', normalized: '0-1000',
    });
    expect(observed.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ element_index: 10, frame: { x: 100, y: 100, w: 200, h: 80 } }),
    ]));
    const clicked = await runtime.run({ action: 'click', query: 'General', deliveryMode: 'background' });
    expect(clicked.summary).toContain('native label frame');
    const clicks = callTool.mock.calls.filter(([arg]) => arg.name === 'click').map(([arg]) => arg.arguments);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toEqual(expect.objectContaining({ x: 200, y: 140, pid: 42, window_id: 7 }));
  });

  it('keeps enough post-action elements to reach controls beyond a long sidebar', async () => {
    const elements = [
      { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 0, y: 0, w: 500, h: 700 } },
      ...Array.from({ length: 99 }, (_, index) => ({
        element_index: index + 1, element_token: `element-${index + 1}`,
        role: index === 78 ? 'AXButton' : 'AXStaticText',
        label: index === 78 ? 'Details' : `Sidebar item ${index + 1}`,
        frame: { x: 10, y: 10 + index, w: 100, h: 20 },
      })),
    ];
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 500, height: 700 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 500, screenshot_height: 700,
        tree_markdown: '', elements,
      });
      return result({ ok: true });
    });
    const opened = await new BimaxComputerRuntime().run({ action: 'open', app: 'System Settings' });
    expect(opened.elements).toHaveLength(80);
    expect(opened.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ element_index: 79, label: 'Details' }),
    ]));
  });

  it('disambiguates repeated detail buttons with their nearby row labels', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 700, screenshot_height: 800,
        tree_markdown: '',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 0, y: 0, w: 700, h: 800 } },
          { element_index: 40, role: 'AXStaticText', label: 'Battery Health', frame: { x: 250, y: 100, w: 130, h: 30 } },
          { element_index: 41, role: 'AXStaticText', label: 'Normal', frame: { x: 500, y: 100, w: 60, h: 30 } },
          { element_index: 69, element_token: 'battery-detail', role: 'AXButton', label: 'Show Detail', frame: { x: 620, y: 100, w: 30, h: 30 } },
          { element_index: 50, role: 'AXStaticText', label: 'Charging', frame: { x: 250, y: 160, w: 100, h: 30 } },
          { element_index: 70, element_token: 'charging-detail', role: 'AXButton', label: 'Show Detail', frame: { x: 620, y: 160, w: 30, h: 30 } },
        ],
      });
      if (name === 'click') return result({ effect: 'delivered' });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    const opened = await runtime.run({ action: 'open', app: 'System Settings' });
    expect(opened.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        element_index: 69,
        label: 'Show Detail — Battery Health · Normal',
        context_label: 'Battery Health · Normal',
      }),
      expect.objectContaining({ element_index: 70, label: 'Show Detail — Charging' }),
    ]));

    await runtime.run({ action: 'click', query: 'Battery Health · Normal', deliveryMode: 'background' });
    const click = callTool.mock.calls.find(([arg]) => arg.name === 'click')?.[0];
    expect(click.arguments).toEqual(expect.objectContaining({ x: 635, y: 115, pid: 42, window_id: 7 }));
  });

  it('refuses semantic clicks on structural accessibility containers', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 700, screenshot_height: 800,
        tree_markdown: '',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 0, y: 0, w: 700, h: 800 } },
          { element_index: 1, element_token: 'sidebar', role: 'AXOutline', label: 'Sidebar', frame: { x: 0, y: 50, w: 220, h: 700 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'System Settings' });
    const clicked = await runtime.run({ action: 'click', elementIndex: 1 });
    expect(clicked.ok).toBe(false);
    expect(clicked.error).toMatch(/structural container/i);
    expect(callTool.mock.calls.some(([arg]) => arg.name === 'click')).toBe(false);
  });

  it('reports embedded host attribution as ready when bundle identity is the only failed check', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'health_report') return result({
        overall: 'degraded',
        checks: [
          { name: 'bundle_identity', status: 'fail', message: 'Process has no CFBundleIdentifier.' },
          { name: 'tcc_accessibility', status: 'pass' },
          { name: 'tcc_screen_recording', status: 'pass' },
          { name: 'ax_capability', status: 'pass' },
          { name: 'screen_capture_capability', status: 'pass' },
        ],
      });
      return result({ ok: true });
    });
    const status = await new BimaxComputerRuntime().run({ action: 'status' });
    expect(status).toEqual(expect.objectContaining({
      ok: true, accessibility: true, screenRecording: true,
      summary: 'Bimax Computer Use ready',
      details: expect.objectContaining({ overall: 'ready', attribution: 'embedded_host' }),
    }));
  });

  it('physically clicks a fresh elementIndex at its screenshot center', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', app: 'System Settings',
      x: cmd.x, y: cmd.y, summary: 'physical click delivered',
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 350, height: 400 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings-element.png', screenshot_width: 700, screenshot_height: 800,
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 100, y: 50, w: 350, h: 400 } },
          { element_index: 20, element_token: 'battery', role: 'AXStaticText', label: 'Battery', frame: { x: 150, y: 100, w: 100, h: 40 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });
    const clicked = await runtime.run({ action: 'click', elementIndex: 20 });

    expect(clicked.ok).toBe(true);
    expect(clicked.summary).toContain('physical mouse click on "Battery"');
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'click', x: 200, y: 120, normalized: false, app: 'System Settings',
    }), undefined);
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'click')).toHaveLength(0);
  });

  it('forwards normalized screenshot coordinates in the driver PNG pixel space', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 1400, screenshot_height: 1600,
        tree_markdown: 'Battery Health',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });
    await runtime.run({ action: 'click', x: 750, y: 250, normalized: true, deliveryMode: 'background' });

    const click = callTool.mock.calls.find(([arg]) => arg.name === 'click')?.[0];
    expect(click.arguments).toEqual(expect.objectContaining({ x: 1049, y: 400, pid: 42, window_id: 7 }));
  });

  it('uses the real global cursor for foreground screenshot clicks', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', summary: 'clicked',
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings.png', screenshot_width: 1400, screenshot_height: 1600,
        tree_markdown: 'Battery Health',
        elements: [
          { element_index: 0, element_token: 'window', role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });
    const clicked = await runtime.run({
      action: 'click', x: 750, y: 250, normalized: true, deliveryMode: 'foreground', modifier: ['cmd'],
    });

    expect(clicked.summary).toContain('physical mouse click');
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'click', x: 625, y: 250, normalized: false, app: 'System Settings',
      modifier: ['cmd'],
    }), undefined);
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'click')).toHaveLength(0);
  });

  it('maps screenshot pixels through the LIVE post-activation window bounds', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', app: 'System Settings',
      x: cmd.x, y: cmd.y, summary: 'physical click delivered',
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_apps') return result({ apps: [{ name: 'System Settings', active: true }] });
      if (name === 'list_windows') return result({
        windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 900, y: 300, width: 800, height: 600 } }],
      });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings-live-frame.png', screenshot_width: 1000, screenshot_height: 1000,
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 100, w: 500, h: 500 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });
    const clicked = await runtime.run({ action: 'click', x: 500, y: 500 });

    expect(clicked.ok).toBe(true);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'click', x: 1300, y: 600, normalized: false,
    }), undefined);
    expect(clicked.details).toEqual(expect.objectContaining({
      inputVerified: true,
      screenshotPoint: { x: 500, y: 500 },
      requestedGlobalPoint: { x: 1300, y: 600 },
      landedGlobalPoint: { x: 1300, y: 600 },
    }));
  });

  it('does not claim success when the physical cursor misses the requested point', async () => {
    const native: any = {
      run: jest.fn(async (cmd: any) => ({
        ok: true, action: cmd.action, driver: 'native-helper', app: 'System Settings',
        x: Number(cmd.x) + 25, y: cmd.y, summary: 'cursor moved elsewhere',
      })),
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_apps') return result({ apps: [{ name: 'System Settings', active: true }] });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, bounds: { x: 100, y: 50, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings-miss.png', screenshot_width: 1400, screenshot_height: 1600,
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'System Settings' });
    await runtime.run({ action: 'observe' });
    const clicked = await runtime.run({ action: 'click', x: 700, y: 800 });
    expect(clicked.ok).toBe(false);
    expect(clicked.error).toMatch(/did not land/);
  });

  it('uses the same real cursor for foreground drag and scroll', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done`,
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'TextEdit',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/textedit.png', screenshot_width: 1400, screenshot_height: 1600,
        tree_markdown: 'TextEdit',
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'TextEdit' });
    await runtime.run({ action: 'observe' });
    const dragged = await runtime.run({
      action: 'drag', x: 100, y: 200, toX: 800, toY: 200, normalized: true, deliveryMode: 'foreground',
    });
    const scrolled = await runtime.run({
      action: 'scroll', x: 500, y: 500, dy: 240, normalized: true, deliveryMode: 'foreground',
    });

    expect(dragged.summary).toContain('visible native cursor drag');
    expect(scrolled.summary).toContain('visible native cursor scrolled');
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'drag', x: 170, y: 210, toX: 660, toY: 210,
    }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'scroll', x: 450, y: 450, dy: 240,
    }), undefined);
    expect(callTool.mock.calls.some(([arg]) => arg.name === 'drag' || arg.name === 'scroll')).toBe(false);
    // The drag ran through the explicit state machine and recorded every phase, ending verified.
    expect((dragged.details as any).dragTrace?.map((e: any) => e.phase)).toEqual([
      'idle', 'source-located', 'source-verified', 'mouse-down', 'dragging', 'dragging',
      'destination-located', 'destination-verified', 'mouse-up', 'verified',
    ]);
  });

  it('grounds both drag ends in semantic element handles from the newest observation', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done`,
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Finder',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Finder', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/finder.png', screenshot_width: 1400, screenshot_height: 1600,
        tree_markdown: 'Finder',
        elements: [
          { element_index: 1, element_token: 'shot-1', role: 'AXImage', label: 'Screenshot 1.png', frame: { x: 200, y: 250, w: 100, h: 100 } },
          { element_index: 2, element_token: 'trash-row', role: 'AXRow', label: 'Trash', frame: { x: 150, y: 650, w: 200, h: 50 } },
        ],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Finder' });
    await runtime.run({ action: 'observe' });

    const dragged = await runtime.run({
      action: 'drag', query: 'Screenshot 1.png', toQuery: 'Trash', deliveryMode: 'foreground',
    });
    expect(dragged.ok).toBe(true);
    expect(dragged.summary).toContain('visible native cursor drag');
    // Element centers: source (250,300) global, destination (250,675) global.
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({
      action: 'drag', x: 250, y: 300, toX: 250, toY: 675,
    }), undefined);

    const byToken = await runtime.run({
      action: 'drag', elementToken: 'shot-1', toElementToken: 'trash-row', deliveryMode: 'foreground',
    });
    expect(byToken.ok).toBe(true);
    expect(nativeRun).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'drag', x: 250, y: 300, toX: 250, toY: 675,
    }), undefined);
  });

  it('rejects a drag missing either end with an error that names the semantic alternatives', async () => {
    const native: any = {
      run: jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: 'done' })),
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Finder',
    };
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Calculator' });

    const noSource = await runtime.run({ action: 'drag', toX: 10, toY: 10 });
    expect(noSource.ok).toBe(false);
    expect(noSource.error).toMatch(/drag needs a source: query\/elementToken\/elementIndex/);

    const noDest = await runtime.run({ action: 'drag', x: 10, y: 10 });
    expect(noDest.ok).toBe(false);
    expect(noDest.error).toMatch(/drag needs a destination: toQuery\/toElementToken\/toElementIndex/);
  });

  it('delivers fine-grained pointer primitives with the visible cursor (hover/hold/mouse_down/mouse_up)', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'TextEdit' };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/te.png', screenshot_width: 1400, screenshot_height: 1600,
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'TextEdit', deliveryMode: 'foreground' });
    await runtime.run({ action: 'observe' });
    await runtime.run({ action: 'hover', x: 700, y: 800, deliveryMode: 'foreground' });
    await runtime.run({ action: 'hold', x: 700, y: 800, ms: 500, deliveryMode: 'foreground' });
    const down = await runtime.run({ action: 'mouse_down', x: 700, y: 800, deliveryMode: 'foreground' });
    await runtime.run({ action: 'mouse_up', x: 700, y: 800, deliveryMode: 'foreground' });
    // screenshot pixel 700,800 in a 1400×1600 image of window {100,50,700,800} → global 450,450.
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'hover', x: 450, y: 450 }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'hold', x: 450, y: 450, ms: 500 }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'mouse_down', x: 450, y: 450 }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'mouse_up', x: 450, y: 450 }), undefined);
    expect(down.summary).toMatch(/button held/i); // a bare mouse_down warns the button is still down
    expect(runtime.lastMechanism()).toBe('physical-foreground');
  });

  it('resolves a human app name when launch_app returns only a bundle id (no "opened ?")', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ pid: 81453, windows: [{ window_id: 9 }] }); // no name
      if (name === 'list_apps') return result({ apps: [{ pid: 81453, name: 'WhatsApp', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 9, is_on_screen: true, bounds: { width: 800, height: 600 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/wa.png', screenshot_width: 800, screenshot_height: 600, elements: [] });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    const opened = await runtime.run({ action: 'open', bundleId: 'net.whatsapp.WhatsApp', deliveryMode: 'foreground' });
    expect(opened.app).toBe('WhatsApp');
    expect(opened.summary).not.toContain('opened ?');
    expect(opened.summary).toContain('WhatsApp');
  });

  it('warns instead of claiming success when an opened app never becomes frontmost', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'WhatsApp', pid: 81453, windows: [{ window_id: 9 }] });
      // The terminal stays frontmost even though bring_to_front returned ok (the real WhatsApp bug).
      if (name === 'list_apps') return result({ apps: [{ pid: 500, name: 'Terminal', active: true }, { pid: 81453, name: 'WhatsApp', active: false }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 9, is_on_screen: true, bounds: { width: 800, height: 600 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/wa.png', screenshot_width: 800, screenshot_height: 600, elements: [] });
      return result({ ok: true });
    });
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'Terminal' };
    const runtime = new BimaxComputerRuntime(native);
    const opened = await runtime.run({ action: 'open', app: 'WhatsApp', deliveryMode: 'foreground' });
    expect(opened.frontmostWarning).toBeTruthy();
    expect(opened.frontmostWarning).toContain('Terminal');
    expect(opened.summary).toContain('WARNING');
    // Escalated to the native `open -a` contract when bring_to_front left the wrong app in front.
    expect(nativeRun.mock.calls.some(([c]: any) => c.action === 'open' && c.app === 'WhatsApp')).toBe(true);
  });

  it('acquires the app window for screenshot instead of full-display capturing the terminal', async () => {
    let windowReady = false;
    const fullDisplay = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: 'screenshot of display 1 with Terminal frontmost' }));
    const native: any = { run: fullDisplay, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'WhatsApp' };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'WhatsApp', pid: 81453, windows: [] }); // window not enumerable yet
      if (name === 'list_apps') return result({ apps: [{ pid: 81453, name: 'WhatsApp', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: windowReady ? [{ window_id: 9, is_on_screen: true, bounds: { width: 800, height: 600 } }] : [] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/wa.png', screenshot_width: 800, screenshot_height: 600, elements: [] });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'WhatsApp', deliveryMode: 'foreground' });
    windowReady = true; // the window becomes enumerable once the app settles
    const shot = await runtime.run({ action: 'screenshot' });
    expect(shot.screenshot).toBe('/tmp/wa.png');
    expect(shot.width).toBe(800);
    // The whole-screen fallback (which would have captured the terminal) was never used.
    expect(fullDisplay.mock.calls.some(([c]: any) => c.action === 'screenshot')).toBe(false);
  });

  it('waits for the window to finish rendering instead of capturing a 35px menu-bar strip', async () => {
    let ticks = 0;
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Finder', pid: 615, windows: [{ window_id: 2272 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 615, name: 'Finder', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') {
        // Finder's window is a 1559×35 toolbar strip for the first polls, then fills in to full size.
        ticks++;
        return result({ windows: [{ window_id: 2272, is_on_screen: true, bounds: { width: 1559, height: ticks >= 3 ? 900 : 35 } }] });
      }
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/desk.png', screenshot_width: 1342, screenshot_height: 1568, elements: [] });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Finder', deliveryMode: 'background' });
    const shot = await runtime.run({ action: 'screenshot' });
    expect(shot).toEqual(expect.objectContaining({ ok: true, windowId: 2272, width: 1342 }));
    // It polled past the 35px strip (≥3 list_windows) rather than capturing the half-rendered window.
    expect(ticks).toBeGreaterThanOrEqual(3);
  });

  it('normalizes Finder name launch to its bundle id and creates a real window from the menu proxy', async () => {
    let realWindow = false;
    const nativeRun = jest.fn(async (cmd: any) => {
      if (cmd.action === 'key' && cmd.combo === 'cmd+n') realWindow = true;
      return { ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` };
    });
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'Finder' };
    callTool.mockImplementation(async ({ name, arguments: args }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') {
        expect(args).toEqual(expect.objectContaining({ bundle_id: 'com.apple.finder' }));
        expect(args.name).toBeUndefined();
        expect(args.creates_new_application_instance).toBeUndefined();
        return result({ name: 'Finder', pid: 615, windows: [{ window_id: 2272 }] });
      }
      if (name === 'list_apps') return result({ apps: [{ pid: 615, name: 'Finder', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: realWindow
        ? [{ window_id: 3001, is_on_screen: true, bounds: { width: 900, height: 700 } }]
        : [{ window_id: 2272, is_on_screen: true, bounds: { width: 1559, height: 35 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/finder.png', screenshot_width: 900, screenshot_height: 700, elements: [] });
      return result({ ok: true });
    });

    const runtime = new BimaxComputerRuntime(native);
    const opened = await runtime.run({ action: 'open', app: 'Finder', newInstance: true, deliveryMode: 'foreground' });
    expect(opened).toEqual(expect.objectContaining({ ok: true, app: 'Finder', windowId: 3001, width: 900, height: 700 }));
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'key', combo: 'cmd+n' }), undefined);
  });

  it('maps System Settings sheets through the parent window and blocks clicks behind the modal', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', x: cmd.x, y: cmd.y,
      app: 'System Settings', summary: `${cmd.action} delivered`,
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 9 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 42, name: 'System Settings', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [
        { window_id: 9, is_on_screen: true, bounds: { x: 200, y: 300, width: 500, height: 200 } },
        { window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } },
      ] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings-parent.png', screenshot_width: 700, screenshot_height: 800,
        elements: [
          { element_index: 1, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } },
          { element_index: 2, role: 'AXButton', label: 'Done', frame: { x: 550, y: 430, w: 100, h: 40 } },
        ],
      });
      return result({ ok: true });
    });

    const runtime = new BimaxComputerRuntime(native);
    const opened = await runtime.run({ action: 'open', app: 'System Settings', deliveryMode: 'foreground' });
    expect(opened).toEqual(expect.objectContaining({ ok: true, windowId: 7 }));
    expect(opened.completionGuidance).toMatch(/foreground dialog is currently detected/i);

    const blocked = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'foreground' });
    expect(blocked).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/foreground dialog is blocking/i) }));
    const inside = await runtime.run({ action: 'click', elementIndex: 2, deliveryMode: 'foreground' });
    expect(inside.ok).toBe(true);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'click', x: 600, y: 450 }), undefined);
    // The sidecar may report the closed sheet for one stale list_windows tick. A verified click on
    // the semantic Done control must still unblock the freshly visible parent page.
    const parent = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'foreground' });
    expect(parent.ok).toBe(true);
  });

  it('right-click returns a full-display observation and menu clicks skip activation', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    // Minimal real PNG header (1440x900) so displayObservation can read authoritative dimensions.
    const displayPng = path.join(os.tmpdir(), `bimax-test-display-${Date.now()}.png`);
    const png = Buffer.alloc(24);
    png.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1440, 16);
    png.writeUInt32BE(900, 20);
    fs.writeFileSync(displayPng, png);

    const nativeRun = jest.fn(async (cmd: any) => cmd.action === 'screenshot'
      ? { ok: true, action: 'screenshot', driver: 'native-helper', screenshot: displayPng, summary: 'display captured' }
      : { ok: true, action: cmd.action, driver: 'native-helper', x: cmd.x, y: cmd.y, app: 'Finder', summary: `${cmd.action} delivered` });
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Finder',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Finder', pid: 12, windows: [{ window_id: 5 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 12, name: 'Finder', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 5, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 500 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/finder.png', screenshot_width: 700, screenshot_height: 500,
        elements: [{ element_index: 1, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 500 } }],
      });
      return result({ ok: true });
    });

    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Finder', deliveryMode: 'foreground' });
    const rightClick = await runtime.run({ action: 'click', x: 350, y: 250, button: 'right', deliveryMode: 'foreground' });
    expect(rightClick.ok).toBe(true);
    // The evidence is the full display, not the window PNG.
    expect(rightClick.screenshot).toBe(displayPng);
    expect(rightClick).toEqual(expect.objectContaining({ width: 1440, height: 900 }));
    expect(rightClick.completionGuidance).toMatch(/FULL DISPLAY/);

    // Element handles from the window observation are invalid now.
    await expect(runtime.run({ action: 'click', elementIndex: 1, deliveryMode: 'foreground' }))
      .resolves.toEqual(expect.objectContaining({ ok: false }));

    const frontsBefore = callTool.mock.calls.filter(([arg]) => arg.name === 'bring_to_front').length;
    // Clicking a menu item: display pixels map 1:1 to global points, no activation.
    const menuClick = await runtime.run({ action: 'click', x: 400, y: 300, deliveryMode: 'foreground' });
    expect(menuClick.ok).toBe(true);
    const menuNative = nativeRun.mock.calls.find(([cmd]: any[]) => cmd.action === 'click' && cmd.button !== 'right');
    expect(menuNative?.[0]).toEqual(expect.objectContaining({ x: 400, y: 300 }));
    expect(callTool.mock.calls.filter(([arg]) => arg.name === 'bring_to_front').length).toBe(frontsBefore);
    fs.rmSync(displayPng, { force: true });
  });

  it('escape dismissal clears the transient dialog guard like a Done/Close click', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', x: cmd.x, y: cmd.y,
      app: 'System Settings', summary: `${cmd.action} delivered`,
    }));
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'System Settings',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 9 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 42, name: 'System Settings', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [
        { window_id: 9, is_on_screen: true, bounds: { x: 200, y: 300, width: 500, height: 200 } },
        { window_id: 7, is_on_screen: true, bounds: { x: 100, y: 50, width: 700, height: 800 } },
      ] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/settings-parent.png', screenshot_width: 700, screenshot_height: 800,
        elements: [
          { element_index: 1, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } },
        ],
      });
      return result({ ok: true });
    });

    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'System Settings', deliveryMode: 'foreground' });
    const blocked = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'foreground' });
    expect(blocked.ok).toBe(false);
    const escaped = await runtime.run({ action: 'key', combo: 'escape', deliveryMode: 'foreground' });
    expect(escaped.ok).toBe(true);
    // WindowServer may keep the dismissed sheet enumerable for a tick; Escape is a semantic
    // dismissal and must unblock the parent page exactly like a verified Done/Close click.
    const parent = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'foreground' });
    expect(parent.ok).toBe(true);
  });

  it('fails honestly when loginwindow prevents the sidecar from producing screenshot pixels', async () => {
    const native: any = {
      run: jest.fn(),
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'loginwindow',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'System Settings', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'list_windows') return result({ windows: [
        { window_id: 7, is_on_screen: true, bounds: { x: 0, y: 0, width: 700, height: 800 } },
      ] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/missing-locked-shot.png', elements: [] });
      return result({ ok: true });
    });

    const runtime = new BimaxComputerRuntime(native);
    const opened = await runtime.run({ action: 'open', app: 'System Settings', deliveryMode: 'background' });
    expect(opened).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringMatching(/Mac screen is locked.*loginwindow/i),
    }));
  });

  it('bounds immediate stale-handle failures until a fresh observation resets input', async () => {
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator', deliveryMode: 'background' });
    await runtime.run({ action: 'observe' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const failed = await runtime.run({ action: 'click', query: 'definitely absent', deliveryMode: 'background' });
      expect(failed.ok).toBe(false);
    }
    const bounded = await runtime.run({ action: 'click', query: 'another absent target', deliveryMode: 'background' });
    expect(bounded.error).toMatch(/three consecutive input actions failed/i);
    const refreshed = await runtime.run({ action: 'observe' });
    expect(refreshed.ok).toBe(true);
    const retry = await runtime.run({ action: 'click', query: 'still absent', deliveryMode: 'background' });
    expect(retry.error).not.toMatch(/three consecutive input actions failed/i);
  });

  it('glides the one cursor into the target window before foreground typing', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper',
      ...(cmd.action === 'cursor' ? { x: 5, y: 5 } : {}), // cursor currently OUTSIDE the window
      summary: `${cmd.action} done`,
    }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'TextEdit' };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/te.png', screenshot_width: 1400, screenshot_height: 1600,
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'TextEdit', deliveryMode: 'foreground' });
    await runtime.run({ action: 'observe' });
    await runtime.run({ action: 'type', text: 'hi', deliveryMode: 'foreground' });
    // Cursor was read, found outside the window, and glided to the window centre before typing.
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'cursor' }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'move', x: 450, y: 450 }), undefined);
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'type', text: 'hi', app: 'TextEdit' }), undefined);
  });

  it('tracks the active execution surface on open and clears it on close', async () => {
    let closed = false;
    const nativeRun = jest.fn(async (cmd: any) => {
      if (cmd.action === 'key' && cmd.combo === 'cmd+w') closed = true;
      return { ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` };
    });
    const native: any = {
      run: nativeRun,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'TextEdit',
    };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 42, name: 'TextEdit', active: true }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: closed ? [] : [{ window_id: 7, is_on_screen: true, bounds: { width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({
        screenshot_file_path: '/tmp/te.png', screenshot_width: 700, screenshot_height: 800,
        elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 100, y: 50, w: 700, h: 800 } }],
      });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'TextEdit', deliveryMode: 'foreground' });
    const surface = runtime.activeSurface();
    expect(surface).toEqual(expect.objectContaining({
      kind: 'native-window', app: 'TextEdit', pid: 42, windowId: 7, focusOwner: 'agent',
      bounds: { x: 100, y: 50, w: 700, h: 800 }, captureSafe: true, backgroundCapable: true,
    }));
    // close removes the surface so it can't linger into the next task.
    await runtime.run({ action: 'close' });
    expect(runtime.activeSurface()).toBeNull();
  });

  it('does not claim agent input ownership when the opened app never came frontmost', async () => {
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'WhatsApp', pid: 81453, windows: [{ window_id: 9 }] });
      if (name === 'list_apps') return result({ apps: [{ pid: 500, name: 'Terminal', active: true }, { pid: 81453, name: 'WhatsApp', active: false }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 9, is_on_screen: true, bounds: { width: 800, height: 600 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: '/tmp/wa.png', screenshot_width: 800, screenshot_height: 600, elements: [] });
      return result({ ok: true });
    });
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'Terminal' };
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'WhatsApp', deliveryMode: 'foreground' });
    // Surface exists but the agent does NOT own input, because the terminal stayed frontmost.
    expect(runtime.activeSurface()?.focusOwner).toBe('none');
  });

  it('pauses for user takeover, refuses to act, then resumes', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} done` }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }), frontmostApp: async () => 'Calculator' };
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Calculator', deliveryMode: 'foreground' });
    await runtime.run({ action: 'observe' });

    // User takes over → the agent must not act.
    runtime.pauseForUser();
    expect(runtime.activeSurface()?.focusOwner).toBe('user');
    const refused = await runtime.run({ action: 'type', text: 'hi', deliveryMode: 'foreground' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/paused for user takeover/i);
    expect(nativeRun.mock.calls.some(([c]: any) => c.action === 'type')).toBe(false); // never delivered

    // Resume → the agent acts again.
    runtime.resume();
    expect(runtime.activeSurface()?.focusOwner).toBe('agent');
    const typed = await runtime.run({ action: 'type', text: 'hi', deliveryMode: 'foreground' });
    expect(typed.ok).toBe(true);
    expect(runtime.lastMechanism()).toBe('physical-foreground');
  });

  it('records the honest delivery mechanism per action (foreground vs background)', async () => {
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' });
    await runtime.run({ action: 'observe' });
    await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
    expect(runtime.lastMechanism()).toBe('sidecar-background'); // no AX handle → synthetic path
    await runtime.run({ action: 'click', query: '216,174', deliveryMode: 'background' });
    expect(runtime.lastMechanism()).toBe('accessibility'); // named element → AX preferred
  });

  it('attaches a typed no-change verification and a recovery hint when actions do not change the screen', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const tmp = path.join(os.tmpdir(), `bimax-verify-${Date.now()}.png`);
    fs.writeFileSync(tmp, Buffer.from([9, 9, 9, 9])); // identical bytes each observe → identical frameHash
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 500, height: 700 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: tmp, screenshot_width: 500, screenshot_height: 700, elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 0, y: 0, w: 500, h: 700 } }] });
      return result({ ok: true });
    });
    try {
      const runtime = new BimaxComputerRuntime();
      await runtime.run({ action: 'open', app: 'Calculator' });
      await runtime.run({ action: 'observe' });
      const c1 = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      expect(c1.progressCheck?.outcome).toBe('no-change'); // driver "succeeded" but the screen is unchanged
      await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      const c3 = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      expect(c3.recoveryHint).toMatch(/no visible change/i); // 3 consecutive no-effect actions → nudge
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('bounds a stuck agent: refuses to keep acting once the recovery budget is exhausted, until it re-observes', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const tmp = path.join(os.tmpdir(), `bimax-recov-${Date.now()}.png`);
    fs.writeFileSync(tmp, Buffer.from([7, 7, 7, 7])); // identical bytes each observe → identical frameHash → no-change
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 500, height: 700 } }] });
      if (name === 'get_window_state') return result({ screenshot_file_path: tmp, screenshot_width: 500, screenshot_height: 700, elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 0, y: 0, w: 500, h: 700 } }] });
      return result({ ok: true });
    });
    try {
      const runtime = new BimaxComputerRuntime();
      await runtime.run({ action: 'open', app: 'Calculator' });
      await runtime.run({ action: 'observe' });
      // Four no-effect clicks exhaust the no-progress budget (maxNoProgress = 4).
      let last: any;
      for (let i = 0; i < 4; i++) last = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      expect(last.recoveryDecision).toBe('stop-failure');

      // The NEXT acting verb is refused — the agent cannot keep hammering the stuck UI.
      const refused = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(/recovery budget exhausted/i);
      expect(callTool.mock.calls.filter(([a]) => a.name === 'click')).toHaveLength(4); // the 5th never reached the driver

      // Re-observing is the agent re-orienting itself — it resets the budget so real work can resume.
      await runtime.run({ action: 'observe' });
      const allowed = await runtime.run({ action: 'click', x: 100, y: 100, deliveryMode: 'background' });
      expect(allowed.ok).toBe(true);
      expect(callTool.mock.calls.filter(([a]) => a.name === 'click')).toHaveLength(5);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('records a durable, resumable session (action history + active surface persisted)', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-dur-'));
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({ screenshot_width: 700, screenshot_height: 800, elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 0, y: 0, w: 700, h: 800 } }] });
      return result({ ok: true });
    });
    try {
      const runtime = new BimaxComputerRuntime();
      await runtime.run({ action: 'open', app: 'TextEdit', deliveryMode: 'background' }, { cwd });
      await runtime.run({ action: 'observe' }, { cwd });
      await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd });
      const hist = runtime.history();
      expect(hist.byAction.open).toBe(1);
      expect(hist.byAction.click).toBe(1);
      expect(runtime.sessionSummary().surface?.app).toBe('TextEdit');
      expect(runtime.memoryFootprint().historyKept).toBeGreaterThanOrEqual(2);
      // dispose persists a final snapshot; a fresh runtime can RESUME it after an interruption.
      await runtime.dispose();
      const resumed = new BimaxComputerRuntime().loadPersistedState(cwd);
      expect(resumed?.surface?.app).toBe('TextEdit');
      expect(resumed?.history.total).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('resumes the persisted history when a fresh runtime reopens the same app after an interruption', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-resume-'));
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'TextEdit', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'list_windows') return result({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 700, height: 800 } }] });
      if (name === 'get_window_state') return result({ screenshot_width: 700, screenshot_height: 800, elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 0, y: 0, w: 700, h: 800 } }] });
      return result({ ok: true });
    });
    try {
      // Session 1: act, then simulate an interruption. dispose persists the final snapshot.
      const first = new BimaxComputerRuntime();
      await first.run({ action: 'open', app: 'TextEdit', deliveryMode: 'background' }, { cwd });
      await first.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd });
      const before = first.history().total;
      expect(before).toBeGreaterThanOrEqual(2);
      await first.dispose();

      // Session 2: a brand-new runtime opens the SAME app in the SAME cwd → history continues.
      const second = new BimaxComputerRuntime();
      await second.run({ action: 'open', app: 'TextEdit', deliveryMode: 'background' }, { cwd });
      expect(second.history().total).toBe(before + 1); // continued, not reset to 1
      expect(second.history().byAction.open).toBe(2);   // one restored open + this one

      // Session 3: a DIFFERENT app must NOT inherit the prior app's history.
      callTool.mockImplementation(async ({ name }: any) => {
        if (name === 'start_session') return result({ ok: true });
        if (name === 'launch_app') return result({ name: 'Calculator', pid: 99, windows: [{ window_id: 3 }] });
        if (name === 'bring_to_front') return result({ activated: true });
        if (name === 'list_windows') return result({ windows: [{ window_id: 3, is_on_screen: true, bounds: { width: 500, height: 700 } }] });
        if (name === 'get_window_state') return result({ screenshot_width: 500, screenshot_height: 700, elements: [{ element_index: 0, role: 'AXWindow', frame: { x: 0, y: 0, w: 500, h: 700 } }] });
        return result({ ok: true });
      });
      const third = new BimaxComputerRuntime();
      await third.run({ action: 'open', app: 'Calculator', deliveryMode: 'background' }, { cwd });
      expect(third.history().byAction.open).toBe(1); // fresh — different app, no resume
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses to control a different app until it is explicitly opened', async () => {
    const runtime = new BimaxComputerRuntime();
    await runtime.run({ action: 'open', app: 'Calculator' });
    const clicked = await runtime.run({ action: 'click', app: 'System Settings', pid: 99, windowId: 4, x: 1, y: 1 });
    expect(clicked).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('target app mismatch') }));
    expect(callTool.mock.calls.some(([arg]) => arg.name === 'click')).toBe(false);
  });

  it('close closes ONLY the selected window (Cmd+W) — never quits the application', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', app: 'Calculator', summary: 'key delivered' }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true }), frontmostApp: async () => 'Calculator' };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'hotkey') return result({ effect: 'delivered' });
      if (name === 'list_windows') return result({ windows: [] });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Calculator' });
    const closed = await runtime.run({ action: 'close' });
    expect(closed.ok).toBe(true);
    expect(closed.summary).toContain('application still running');
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'key', combo: 'cmd+w' }), undefined);
    expect(callTool.mock.calls.some(([a]) => a.name === 'hotkey')).toBe(false);
    expect(callTool).toHaveBeenCalledWith({ name: 'list_windows', arguments: { pid: 42 } });
  });

  it('quit_app is the separate action that quits the application and verifies it', async () => {
    const nativeRun = jest.fn(async (cmd: any) => ({ ok: true, action: cmd.action, driver: 'native-helper', app: 'Calculator', summary: 'key delivered' }));
    const native: any = { run: nativeRun, quickStatus: () => ({ driver: 'native-helper', ready: true }), frontmostApp: async () => 'Calculator' };
    callTool.mockImplementation(async ({ name }: any) => {
      if (name === 'start_session') return result({ ok: true });
      if (name === 'launch_app') return result({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return result({ activated: true });
      if (name === 'hotkey') return result({ effect: 'delivered' });
      if (name === 'list_windows') return result({ windows: [] });
      return result({ ok: true });
    });
    const runtime = new BimaxComputerRuntime(native);
    await runtime.run({ action: 'open', app: 'Calculator' });
    const quit = await runtime.run({ action: 'quit_app' });
    expect(quit.ok).toBe(true);
    expect(quit.summary).toContain('quit');
    expect(nativeRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'key', combo: 'cmd+q' }), undefined);
    expect(callTool.mock.calls.some(([a]) => a.name === 'hotkey')).toBe(false);
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
