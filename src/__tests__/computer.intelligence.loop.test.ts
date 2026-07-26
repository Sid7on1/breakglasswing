jest.mock('../mcp/client', () => ({
  openClient: jest.fn(),
  isDeadConnectionError: () => false,
}));

import * as fs from 'fs';
import { openClient } from '../mcp/client';
import { BimaxComputerRuntime } from '../computer/desktop.runtime';
import { __resetConfigForTests } from '../cli/config';

const ok = (structuredContent: unknown) => ({ structuredContent, content: [], isError: false });
const BEFORE = '/tmp/bimax-intelligence-before.png';
const AFTER = '/tmp/bimax-intelligence-after.png';

function native() {
  return {
    run: jest.fn(async (cmd: any) => ({
      ok: true, action: cmd.action, driver: 'native-helper', app: 'Demo', x: cmd.x, y: cmd.y,
      summary: `${cmd.action} delivered`,
    })),
    quickStatus: () => ({ driver: 'native-helper', ready: true, accessibility: true, screenRecording: true }),
    frontmostApp: async () => 'Demo',
  } as any;
}

describe('confidence-aware computer-use loop', () => {
  const callTool = jest.fn();
  let acted = false;

  beforeEach(() => {
    jest.clearAllMocks();
    acted = false;
    fs.writeFileSync(BEFORE, 'before-frame');
    fs.writeFileSync(AFTER, 'after-frame');
    process.env.BIMAX_COMPUTER_USE_DRIVER = process.execPath;
    process.env.BIMAX_COMPUTER_PIP = '0';
    process.env.BIMAX_COMPUTER_VISIBLE = '0';
    __resetConfigForTests();
    (openClient as jest.Mock).mockResolvedValue({ callTool, close: jest.fn() });
    callTool.mockImplementation(async ({ name, arguments: args }: any) => {
      if (name === 'start_session') return ok({ ok: true });
      if (name === 'launch_app') return ok({ name: 'Demo', pid: 42, windows: [{ window_id: 7 }] });
      if (name === 'bring_to_front') return ok({ activated: true });
      if (name === 'list_windows') return ok({ windows: [
        { window_id: 7, is_on_screen: true, bounds: { x: 10, y: 20, width: 700, height: 500 } },
      ] });
      if (name === 'click') { acted = true; return ok({ effect: 'delivered' }); }
      if (name === 'get_window_state') return ok({
        screenshot_file_path: acted ? AFTER : BEFORE,
        screenshot_width: 700, screenshot_height: 500,
        elements: acted
          ? [{ element_index: 2, role: 'AXHeading', label: 'Dashboard', frame: { x: 20, y: 40, w: 200, h: 30 } }]
          : [{ element_index: 1, role: 'AXButton', label: 'Continue', enabled: true, frame: { x: 20, y: 40, w: 100, h: 30 } }],
        max_elements_echo: args?.max_elements,
      });
      return ok({ ok: true });
    });
  });

  afterEach(() => {
    fs.rmSync(BEFORE, { force: true });
    fs.rmSync(AFTER, { force: true });
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
    delete process.env.BIMAX_COMPUTER_PIP;
    delete process.env.BIMAX_COMPUTER_VISIBLE;
    __resetConfigForTests();
  });

  async function openedRuntime() {
    const runtime = new BimaxComputerRuntime(native());
    expect((await runtime.run({ action: 'open', app: 'Demo' }, { cwd: '/tmp' })).ok).toBe(true);
    expect((await runtime.run({ action: 'observe' }, { cwd: '/tmp' })).ok).toBe(true);
    return runtime;
  }

  it('acts and proves a semantic postcondition in the same call', async () => {
    const runtime = await openedRuntime();
    const result = await runtime.run({
      action: 'click', query: 'Continue button', expect: 'Dashboard', expectMode: 'present',
      deliveryMode: 'background',
    }, { cwd: '/tmp' });
    expect(result.ok).toBe(true);
    expect(result.progressCheck?.outcome).toBe('confirmed');
    expect(result.actionResult).toEqual(expect.objectContaining({
      delivered: true,
      confidence: 'proven',
      postcondition: { query: 'presence of "Dashboard"', matched: true },
    }));
    expect(result.recoveryDecision).toBe('continue');
  });

  it('does not confuse arbitrary pixel change with a missed requested result', async () => {
    const runtime = await openedRuntime();
    const result = await runtime.run({
      action: 'click', query: 'Continue', expect: 'Settings', expectMode: 'present',
      deliveryMode: 'background',
    }, { cwd: '/tmp' });
    expect(result.ok).toBe(true); // delivery succeeded; the postcondition did not
    expect(result.progressCheck?.outcome).toBe('expectation-missed');
    expect(result.actionResult).toEqual(expect.objectContaining({
      confidence: 'unknown',
      postcondition: { query: 'presence of "Settings"', matched: false },
    }));
    expect(result.summary).toMatch(/EXPECTED RESULT NOT FOUND/);
    expect(result.recoveryDecision).toBe('recover');
  });

  it('starts observation cheaply and deepens only when a named target is beyond the first pass', async () => {
    const runtime = await openedRuntime();
    callTool.mockClear();
    callTool.mockImplementation(async ({ name, arguments: args }: any) => {
      if (name === 'get_window_state') {
        const cap = Number(args?.max_elements || 0);
        const filler = Array.from({ length: cap }, (_, i) => ({
          element_index: i, role: 'AXStaticText', label: `Row ${i}`, frame: { x: 10, y: i + 20, w: 80, h: 10 },
        }));
        if (cap >= 600) filler[500] = { element_index: 500, role: 'AXButton', label: 'Deep target', frame: { x: 20, y: 200, w: 100, h: 30 } };
        return ok({ screenshot_file_path: BEFORE, screenshot_width: 700, screenshot_height: 500, elements: filler });
      }
      if (name === 'list_windows') return ok({ windows: [
        { window_id: 7, is_on_screen: true, bounds: { x: 10, y: 20, width: 700, height: 500 } },
      ] });
      return ok({ ok: true });
    });
    const observed = await runtime.run({ action: 'observe', query: 'Deep target' }, { cwd: '/tmp' });
    expect(observed.verification).toEqual(expect.objectContaining({ matched: true }));
    expect((observed.details as any).perception.scanCaps).toEqual([180, 600]);
  });

  it('invalidates a planned action when an AX event arrives after observation', async () => {
    let notify: ((event: any) => void) | undefined;
    const stop = jest.fn();
    const fallback = {
      ...native(),
      watchAccessibility: jest.fn((pid: number, onEvent: (event: any) => void) => {
        notify = onEvent;
        return stop;
      }),
    } as any;
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'open', app: 'Demo', deliveryMode: 'background' }, { cwd: '/tmp' });
    const observed = await runtime.run({ action: 'observe' }, { cwd: '/tmp' });
    expect(observed.ok).toBe(true);
    notify?.({ pid: 42, notification: 'AXValueChanged', timestampMs: Date.now() });

    const refused = await runtime.run({
      action: 'click', query: 'Continue', frameId: observed.frameId, deliveryMode: 'background',
    }, { cwd: '/tmp' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/accessibility state changed.*AXValueChanged/i);
    expect(callTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'click' }));
    await runtime.dispose();
    expect(stop).toHaveBeenCalled();
  });

  it('uses on-device OCR only after native semantic search misses', async () => {
    const fallback = native();
    fallback.run.mockImplementation(async (cmd: any) => {
      if (cmd.action === 'visual_analysis') return {
        ok: true, action: cmd.action, driver: 'native-helper', summary: 'analysed',
        visualAnalysis: {
          texts: [{ text: 'Mystery Control', confidence: 0.96, frame: { x: 100, y: 120, w: 130, h: 24 } }],
          shapes: [{ id: 'shape-0', contourCount: 2, topLevelCount: 1, rectangleCount: 1, kind: 'square' }],
          latencyMs: 9,
        },
      };
      if (cmd.action === 'visual_signatures') return {
        ok: true, action: cmd.action, driver: 'native-helper', summary: 'sampled', visualSignatures: [],
      };
      return { ok: true, action: cmd.action, driver: 'native-helper', summary: `${cmd.action} delivered` };
    });
    const runtime = new BimaxComputerRuntime(fallback);
    await runtime.run({ action: 'open', app: 'Demo', deliveryMode: 'background' }, { cwd: '/tmp' });

    const observed = await runtime.run({ action: 'observe', query: 'Mystery Control' }, { cwd: '/tmp' });
    expect(observed.verification).toEqual({ query: 'Mystery Control', matched: true, matchCount: 1 });
    expect(observed.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'VisualText', label: 'Mystery Control', source: 'on_device_vision' }),
    ]));
    expect((observed.details as any).perception.foveated).toEqual(expect.objectContaining({
      triggered: true, ocrTextRegions: 1, shapeRegions: 1, latencyMs: 9,
    }));
    await runtime.dispose();
  });
});
