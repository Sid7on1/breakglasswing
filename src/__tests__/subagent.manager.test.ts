import { SubAgentManager } from '../core/subagent.manager';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('SubAgentManager — worker watchdog timeout', () => {
  let dir: string;
  let hangScript: string;
  let quickScript: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-worker-'));
    // A worker that never posts a message and never exits.
    hangScript = path.join(dir, 'hang.js');
    fs.writeFileSync(hangScript, 'setInterval(() => {}, 1000);\n');
    // A worker that immediately reports success.
    quickScript = path.join(dir, 'quick.js');
    fs.writeFileSync(quickScript, "const { parentPort } = require('worker_threads'); parentPort.postMessage({ type: 'success', result: 'ok' });\n");
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const cfg = { agentType: 'test', prompt: 'x', cwd: os.tmpdir(), parentMode: 'safe' };

  it('terminates and rejects a worker that exceeds the timeout', async () => {
    const mgr = new SubAgentManager({ workerScriptPath: hangScript, timeoutMs: 300 });
    const start = Date.now();
    await expect(mgr.spawnWorker('t-hang', cfg)).rejects.toThrow(/timed out/i);
    // Rejected promptly (not left hanging) and the worker was cleaned up.
    expect(Date.now() - start).toBeLessThan(3000);
    expect(mgr.activeCount()).toBe(0);
  });

  it('resolves a healthy worker and clears the watchdog (no late rejection)', async () => {
    const mgr = new SubAgentManager({ workerScriptPath: quickScript, timeoutMs: 5000 });
    await expect(mgr.spawnWorker('t-ok', cfg)).resolves.toBe('ok');
    expect(mgr.activeCount()).toBe(0);
    // Give any (incorrectly uncleared) timer a chance to fire — it must not.
    await new Promise(r => setTimeout(r, 50));
  });
});
