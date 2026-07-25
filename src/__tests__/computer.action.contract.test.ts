/**
 * Regression tests — computer-use action outcome contract (P0).
 *
 * 1. ActionResult separates delivery from proof: pixel no-change is NOT a failure, and only a
 *    matched semantic postcondition yields confidence 'proven'.
 * 2. Visually-static verbs (wait/hover/move) never feed the no-progress latch.
 * 3. A latched recovery failure is cleared ONLY by a successful re-observation that produced
 *    fresh evidence — issuing observe/screenshot alone (or a failed capture) does not bypass it.
 */
jest.mock('../mcp/client', () => ({ openClient: jest.fn() }));

import * as fs from 'fs';
import { openClient } from '../mcp/client';
import { BimaxComputerRuntime } from '../computer/desktop.runtime';
import { classifyVerification, toActionResult } from '../computer/verification';
import { __resetConfigForTests } from '../cli/config';

/**
 * A native fallback stub for tests that build a runtime directly.
 *
 * The runtime asks the native helper for the frontmost app before the sidecar (4ms versus 642ms),
 * so a runtime built without one interrogates the REAL desktop and then tries to activate apps that
 * only exist in the fixture. Tests must describe their own desktop.
 */
const hermeticFallback = () => ({
  run: jest.fn(async (cmd: any) => ({
    ok: true, action: cmd.action, driver: 'native-helper', app: cmd.app, x: 10, y: 10,
    summary: `${cmd.action} delivered`,
  })),
  quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
  frontmostApp: async () => 'Calculator',
} as any);

describe('ActionResult contract (pure)', () => {
  it('pixel no-change is delivered-but-unproven, never a failure', () => {
    const v = classifyVerification({ ok: true, prevFrameHash: 'a', nextFrameHash: 'a', hadScreenshot: true });
    const r = toActionResult(v);
    expect(r.delivered).toBe(true);
    expect(r.observed).toBe('no-change');
    expect(r.confidence).toBe('unknown');
    expect(r.failureReason).toBeUndefined();
  });

  it('a visible change is only "likely" — pixels cannot prove task success', () => {
    const v = classifyVerification({ ok: true, prevFrameHash: 'a', nextFrameHash: 'b', hadScreenshot: true });
    const r = toActionResult(v);
    expect(r.confidence).toBe('likely');
    expect(r.observed).toBe('changed');
  });

  it('only a matched semantic postcondition is "proven"', () => {
    const v = classifyVerification({ ok: true, prevFrameHash: 'a', nextFrameHash: 'b', hadScreenshot: true, queryMatched: true });
    const r = toActionResult(v, { query: 'Saved', matched: true });
    expect(r.confidence).toBe('proven');
    expect(r.postcondition).toEqual({ query: 'Saved', matched: true });
  });

  it('driver failure and wrong-window carry a failureReason', () => {
    const failed = toActionResult(classifyVerification({ ok: false, hadScreenshot: false }));
    expect(failed.delivered).toBe(false);
    expect(failed.failureReason).toBeTruthy();
    const wrong = toActionResult(classifyVerification({ ok: true, hadScreenshot: true, nextFrameHash: 'x', expectedApp: 'Notes', actualApp: 'Terminal' }));
    expect(wrong.observed).toBe('wrong-window');
    expect(wrong.failureReason).toMatch(/Notes/);
  });
});

describe('recovery latch semantics (runtime)', () => {
  const callTool = jest.fn();
  const SHOT = '/tmp/bimax-latch-test.png';
  let windowStateFails = false;

  beforeEach(() => {
    jest.clearAllMocks();
    windowStateFails = false;
    process.env.BIMAX_COMPUTER_USE_DRIVER = process.execPath;
    process.env.BIMAX_COMPUTER_RECORD = '0';
    process.env.BIMAX_COMPUTER_PIP = '0';
    process.env.BIMAX_COMPUTER_VISIBLE = '0'; // background delivery → sidecar click path
    __resetConfigForTests();
    fs.writeFileSync(SHOT, 'static-frame-bytes'); // identical bytes every capture → no-change
    (openClient as jest.Mock).mockResolvedValue({ callTool, close: jest.fn() });
    callTool.mockImplementation(async ({ name }: any) => {
      const ok = (structuredContent: any) => ({ structuredContent, content: [], isError: false });
      if (name === 'launch_app') return ok({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'get_window_state') {
        if (windowStateFails) throw new Error('window capture failed');
        return ok({
          screenshot_file_path: SHOT, screenshot_width: 500, screenshot_height: 700,
          elements: [{ element_index: 1, role: 'AXButton', label: 'Go', frame: { x: 0, y: 0, w: 500, h: 700 } }],
        });
      }
      if (name === 'list_windows') return ok({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 500, height: 700 } }] });
      return ok({ ok: true });
    });
  });

  afterEach(() => {
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
    delete process.env.BIMAX_COMPUTER_RECORD;
    delete process.env.BIMAX_COMPUTER_PIP;
    delete process.env.BIMAX_COMPUTER_VISIBLE;
    __resetConfigForTests();
    fs.rmSync(SHOT, { force: true });
  });

  async function latchRuntime() {
    const runtime = new BimaxComputerRuntime(hermeticFallback());
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' }); // ground the frame
    // Repeated no-effect clicks until the recovery authority latches stop-failure.
    for (let i = 0; i < 6; i++) {
      await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    }
    const refused = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/recovery budget exhausted/);
    return runtime;
  }

  it('latches after repeated no-effect actions and refuses further acting verbs', async () => {
    await latchRuntime();
  }, 30000);

  it('a FAILED observe does not clear the latch; a successful fresh observe does', async () => {
    const runtime = await latchRuntime();

    // Observe whose capture fails → no fresh evidence → still latched.
    windowStateFails = true;
    const badObserve = await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    expect(badObserve.ok).toBe(false);
    const stillRefused = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(stillRefused.ok).toBe(false);
    expect(stillRefused.error).toMatch(/recovery budget exhausted/);

    // Successful observe WITH a captured frame → new evidence → latch clears.
    windowStateFails = false;
    const goodObserve = await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    expect(goodObserve.ok).toBe(true);
    expect(goodObserve.frameHash).toBeTruthy();
    const allowed = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(allowed.ok).toBe(true);
  }, 30000);

  it('invalidates stale perception when post-action capture fails', async () => {
    const runtime = new BimaxComputerRuntime(hermeticFallback());
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });

    windowStateFails = true;
    const delivered = await runtime.run(
      { action: 'click', x: 10, y: 10, deliveryMode: 'background' },
      { cwd: '/tmp' },
    );
    expect(delivered.ok).toBe(true);
    expect(delivered.actionResult).toEqual(expect.objectContaining({
      delivered: true,
      observed: 'unverified',
    }));
    expect(delivered.summary).toMatch(/fresh post-action screen could not be captured/);

    const blindFollowUp = await runtime.run(
      { action: 'click', x: 10, y: 10, deliveryMode: 'background' },
      { cwd: '/tmp' },
    );
    expect(blindFollowUp.ok).toBe(false);
    expect(blindFollowUp.error).toMatch(/fresh screenshot.*required before input/);
  }, 30000);

  it('refuses first input before any target observation', async () => {
    const runtime = new BimaxComputerRuntime(hermeticFallback());
    const result = await runtime.run(
      { action: 'click', x: 10, y: 10, pid: 42, windowId: 7, app: 'Calculator', deliveryMode: 'background' },
      { cwd: '/tmp' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/observe the target window first/);
  });

  it('static verbs (wait/hover/move) never feed the no-progress latch', async () => {
    const runtime = new BimaxComputerRuntime(hermeticFallback());
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    // Many pixel-identical waits — legitimately static — must not accrue a stuck state.
    for (let i = 0; i < 8; i++) {
      const r = await runtime.run({ action: 'wait', ms: 50 }, { cwd: '/tmp' });
      expect(r.ok).toBe(true);
    }
    const click = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(click.ok).toBe(true); // no false latch
  }, 30000);
});

describe('routing: one driver implementation per action, one ActionResult', () => {
  const callTool = jest.fn();
  const SHOT = '/tmp/bimax-routing-test.png';

  const fakeFallback = () => {
    const run = jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', app: cmd.app, x: 10, y: 10,
      summary: `${cmd.action} delivered`,
    }));
    return {
      run,
      quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
      frontmostApp: async () => 'Calculator',
    } as any;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BIMAX_COMPUTER_USE_DRIVER = process.execPath;
    process.env.BIMAX_COMPUTER_RECORD = '0';
    process.env.BIMAX_COMPUTER_PIP = '0';
    fs.writeFileSync(SHOT, `frame-${Date.now()}-${Math.random()}`);
    (openClient as jest.Mock).mockResolvedValue({ callTool, close: jest.fn() });
    callTool.mockImplementation(async ({ name }: any) => {
      const ok = (structuredContent: any) => ({ structuredContent, content: [], isError: false });
      if (name === 'launch_app') return ok({ name: 'Calculator', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'get_window_state') {
        fs.writeFileSync(SHOT, `frame-${Date.now()}-${Math.random()}`); // always-fresh frame
        return ok({
          screenshot_file_path: SHOT, screenshot_width: 500, screenshot_height: 700,
          elements: [{ element_index: 1, role: 'AXWindow', frame: { x: 0, y: 0, w: 500, h: 700 } }],
        });
      }
      if (name === 'list_windows') return ok({ windows: [{ window_id: 7, is_on_screen: true, bounds: { width: 500, height: 700 } }] });
      return ok({ ok: true });
    });
  });

  afterEach(() => {
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
    delete process.env.BIMAX_COMPUTER_RECORD;
    delete process.env.BIMAX_COMPUTER_PIP;
    delete process.env.BIMAX_COMPUTER_VISIBLE;
    __resetConfigForTests();
    fs.rmSync(SHOT, { force: true });
  });

  const INPUT_VERBS = new Set(['click', 'type', 'key', 'drag', 'scroll', 'move', 'hover', 'hold', 'mouse_down', 'mouse_up']);

  it('a saved legacy background preference cannot select synthetic input', async () => {
    process.env.BIMAX_COMPUTER_VISIBLE = '0';
    __resetConfigForTests();
    const fallback = fakeFallback();
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    const clicked = await runtime.run({ action: 'click', x: 10, y: 10 }, { cwd: '/tmp' });
    expect(clicked.ok).toBe(true);
    expect(callTool.mock.calls.some(([a]) => a.name === 'click')).toBe(false);
    const fallbackInputCalls = (fallback.run as jest.Mock).mock.calls.filter(([c]) => INPUT_VERBS.has(c.action));
    expect(fallbackInputCalls.filter(([c]) => c.action === 'click')).toHaveLength(1);
    expect(clicked.actionResult).toBeDefined(); // exactly one ActionResult, from evidence
  });

  it('explicit internal background diagnostics still route to the sidecar only', async () => {
    const fallback = fakeFallback();
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    const clicked = await runtime.run({ action: 'click', x: 10, y: 10, deliveryMode: 'background' }, { cwd: '/tmp' });
    expect(clicked.ok).toBe(true);
    expect(callTool.mock.calls.some(([a]) => a.name === 'click')).toBe(true);
    expect((fallback.run as jest.Mock).mock.calls.filter(([c]) => INPUT_VERBS.has(c.action))).toHaveLength(0);
  });

  it('foreground click delivers via the NATIVE fallback only — the sidecar click RPC is never used', async () => {
    process.env.BIMAX_COMPUTER_VISIBLE = '1';
    __resetConfigForTests();
    const fallback = fakeFallback();
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'open', app: 'Calculator' }, { cwd: '/tmp' });
    await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    const clicked = await runtime.run({ action: 'click', x: 10, y: 10 }, { cwd: '/tmp' });
    expect(clicked.ok).toBe(true);
    // Input delivered exactly once, by the native driver.
    const nativeClicks = (fallback.run as jest.Mock).mock.calls.filter(([c]) => c.action === 'click');
    expect(nativeClicks).toHaveLength(1);
    // The sidecar performed windowing/observation ONLY — never the input delivery.
    expect(callTool.mock.calls.some(([a]) => a.name === 'click')).toBe(false);
    expect(clicked.actionResult).toBeDefined();
  });

  it('without a sidecar driver, every action routes to the fallback and the sidecar never spawns', async () => {
    // 'off' (not unset): with no env var the transport now discovers a cached driver from a prior
    // packaged run, which would make this test machine-dependent.
    process.env.BIMAX_COMPUTER_USE_DRIVER = 'off';
    __resetConfigForTests();
    const fallback = fakeFallback();
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'click', x: 5, y: 5, app: 'Notes' }, { cwd: '/tmp' });
    expect(openClient).not.toHaveBeenCalled();
    expect((fallback.run as jest.Mock).mock.calls.filter(([c]) => c.action === 'click')).toHaveLength(1);
  });
});

describe('fallback close is truthful (delivered-but-unverified)', () => {
  it('never claims a verified close, and recovery cannot read it as proven success', async () => {
    const { DesktopRuntime } = require('../computer/desktop.runtime');
    const { RecoveryController } = require('../computer/recovery');
    const runtime = new DesktopRuntime();
    // Stub the underlying key delivery + activation so no real desktop is touched.
    (runtime as any).activateApp = jest.fn().mockResolvedValue('TestApp');
    (runtime as any).runDarwin = jest.fn().mockResolvedValue({ app: 'TestApp', summary: 'pressed cmd+w' });
    (runtime as any).runLinux = jest.fn().mockResolvedValue({ app: 'TestApp', summary: 'pressed ctrl+w' });
    const closed = await runtime.run({ action: 'close', app: 'TestApp' });
    expect(closed.ok).toBe(true);
    expect(closed.actionResult).toEqual(expect.objectContaining({
      delivered: true,
      observed: 'unverified',
      confidence: 'unknown',
      postcondition: { query: 'target window closed', matched: false },
    }));
    expect(closed.summary).toMatch(/cannot verify/);
    expect(closed.summary).toMatch(/^sent close-window/); // states delivery, never claims closure
    // Downstream recovery: an 'unverified' outcome can never latch stop-success.
    const rc = new RecoveryController();
    expect(rc.record(closed.actionResult!.observed)).toBe('continue');
    expect(rc.succeeded).toBe(false);
  });
});
