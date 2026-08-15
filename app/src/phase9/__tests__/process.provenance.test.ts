import { ProcessProvenanceTracker } from '../process.provenance';

describe('Phase 9 Bimax-launched process provenance (S28-D)', () => {
  test('keeps launch identity separate from PID and never stores raw argv or environment', () => {
    let now = 10;
    let id = 0;
    const tracker = new ProcessProvenanceTracker({ now: () => now, id: () => String(++id), capacity: 8 });
    const first = tracker.begin({
      pid: 42, executableBasename: 'bimax-engine', cwdClass: 'project',
      argumentClasses: ['headless-protocol'],
    });
    now = 11;
    tracker.finish(first, { exitCode: 0 });
    const second = tracker.begin({
      pid: 42, executableBasename: 'bimax-engine', cwdClass: 'project',
      argumentClasses: ['headless-protocol'],
    });
    expect(second).not.toBe(first);
    const json = JSON.stringify(tracker.snapshot());
    expect(json).not.toContain('API_KEY');
    expect(json).not.toContain('--token');
    expect(tracker.snapshot().map((row) => row.launchId)).toEqual(['launch_1', 'launch_2']);
  });

  test('stores endpoint identity only, rejects payload-like hosts, and declares event loss', () => {
    const tracker = new ProcessProvenanceTracker({ now: () => 20, id: () => 'a' });
    const launch = tracker.begin({
      pid: 7, executableBasename: 'worker', cwdClass: 'project', argumentClasses: ['test-runner'],
    });
    expect(tracker.endpoint(launch, {
      host: 'Registry.NPMJS.org.', port: 443, transport: 'tcp', direction: 'outbound',
      bytesBand: 'small', declared: true,
    })).toBe(true);
    expect(tracker.endpoint(launch, {
      host: 'example.com/path?token=secret', port: 443, transport: 'tcp', direction: 'outbound',
      bytesBand: 'small', declared: false,
    })).toBe(false);
    tracker.markGap(launch);
    const record = tracker.snapshot()[0];
    expect(record.endpoints[0].host).toBe('registry.npmjs.org');
    expect(record.completeness).toBe('gap');
  });
});

