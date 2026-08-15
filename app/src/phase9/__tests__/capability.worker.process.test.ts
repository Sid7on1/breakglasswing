import path from 'node:path';
import { ProcessCapabilityWorker } from '../capability.worker.process';

const fixture = path.join(__dirname, 'fixtures', 'capability-worker-fixture.js');

describe('Phase 9 out-of-process capability worker (S29-C)', () => {
  test('negotiates identity and invokes a bounded action outside the Desktop process', async () => {
    const worker = new ProcessCapabilityWorker({
      command: process.execPath,
      args: [fixture],
      cwd: __dirname,
      contentDigest: 'sha256:fixture',
      env: { BIMAX_FIXTURE_DIGEST: 'sha256:fixture' },
    });
    const result = await worker.invoke('inspect', { value: 7 }, new AbortController().signal);
    expect(JSON.parse(result.output)).toEqual({ value: 7 });
    expect(result.taint).toEqual(['fixture']);
    await worker.dispose();
  });

  test('refuses digest drift before an action can run', async () => {
    const worker = new ProcessCapabilityWorker({
      command: process.execPath,
      args: [fixture],
      cwd: __dirname,
      contentDigest: 'sha256:expected',
      env: { BIMAX_FIXTURE_DIGEST: 'sha256:other' },
    });
    await expect(worker.invoke('inspect', {}, new AbortController().signal)).rejects.toThrow(/identity/);
    await worker.dispose();
  });

  test('cancellation rejects locally and sends a bounded cancel frame', async () => {
    const worker = new ProcessCapabilityWorker({
      command: process.execPath,
      args: [fixture],
      cwd: __dirname,
      contentDigest: 'sha256:fixture',
      env: { BIMAX_FIXTURE_DIGEST: 'sha256:fixture' },
    });
    const controller = new AbortController();
    const pending = worker.invoke('hang', {}, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow(/cancelled/);
    await worker.dispose();
  });
});

