import * as fs from 'fs';
import * as path from 'path';
import { NativeLivePip } from '../computer/pip';

describe('continuous native PiP contract', () => {
  const root = path.resolve(__dirname, '../..');

  it('uses a continuous ScreenCaptureKit window filter rather than the legacy screenshot viewer', () => {
    const swift = fs.readFileSync(path.join(root, 'native', 'BimaxLivePip.swift'), 'utf8');
    const transport = fs.readFileSync(path.join(root, 'src', 'computer', 'transport.ts'), 'utf8');

    expect(swift).toContain('SCStreamOutput');
    expect(swift).toContain('SCContentFilter(desktopIndependentWindow: target)');
    expect(swift).toContain('first_frame');
    expect(transport).not.toContain("driverArgs.push('--experimental-pip')");
  });

  it('is configured for a smooth preview and the lowest-latency queue', () => {
    // Properties, not constants. This assertion used to pin `timescale: 15`, which capped the
    // preview at 15fps and made the test defend the choppiness instead of catching it — the same
    // way the observe scan budget was pinned at 800. Measured after raising the ceiling: ~57fps
    // sustained, 0 dropped frames, CPU 3-7%, RSS flat.
    const swift = fs.readFileSync(path.join(root, 'native', 'BimaxLivePip.swift'), 'utf8');
    const interval = swift.match(/minimumFrameInterval = CMTime\(value: 1, timescale: (\d+)\)/);
    expect(interval).not.toBeNull();
    expect(Number(interval![1])).toBeGreaterThanOrEqual(30); // a ceiling below 30 cannot reach 30fps
    // Apple documents queueDepth 3-8; 3 is the minimum and so the lowest-latency choice. The output
    // handler keeps only the newest frame, so deeper buffering would only add age.
    expect(swift).toMatch(/queueDepth = 3\b/);
    // Latency and throughput must be measurable, or "real-time" is only an assertion.
    expect(swift).toContain('pip_stats');
    expect(swift).toContain('isReadyForMoreMediaData');
  });

  it('keeps only the newest preview frame and surfaces measured latency', () => {
    // A backlog of obsolete preview frames is strictly worse than dropping them: `main.async` is
    // unbounded, so a busy main thread would push the preview progressively further behind live.
    const swift = fs.readFileSync(path.join(root, 'native', 'BimaxLivePip.swift'), 'utf8');
    expect(swift).toContain('droppedStale');
    expect(swift).toMatch(/pending = sampleBuffer/);

    const pip = new NativeLivePip();
    (pip as any).state = { enabled: true, running: true, continuous: true, captureSafe: true };
    (pip as any).child = { exitCode: null, pid: 4242, stdin: { writable: false } };
    expect(pip.pid()).toBe(4242);
    expect(() => pip.avoid({ x: 0, y: 0, w: 10, h: 10 })).not.toThrow(); // never fails an action
  });

  it('reports an enabled but capture-unsafe waiting state until a target window exists', async () => {
    const pip = new NativeLivePip();
    pip.sync(null, true);
    expect(pip.status()).toEqual({
      enabled: true,
      running: false,
      continuous: true,
      captureSafe: false,
      surface: undefined,
      error: undefined,
    });
    await pip.stop();
  });
});
