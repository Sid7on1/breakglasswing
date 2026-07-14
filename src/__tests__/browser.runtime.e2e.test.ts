import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { BrowserRuntime } from '../browser/browser.runtime';

const browserIt = process.env.BIMAX_BROWSER_E2E === '1' ? it : it.skip;

describe('BrowserRuntime end to end', () => {
  browserIt('navigates, interacts, asserts, diagnoses, and captures durable evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-e2e-'));
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>BiMax Browser Probe</title><main>
        <button id="ready" onclick="document.querySelector('#state').textContent='verified'">Run</button>
        <p id="state">waiting</p></main>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const runtime = new BrowserRuntime();
    try {
      const nav = await runtime.run({ action: 'navigate', url: `http://127.0.0.1:${port}`, retries: 2 }, { cwd: root });
      if (!nav.ok) throw new Error(`Browser navigation failed: ${JSON.stringify(nav)}`);
      expect(nav.status).toBe(200);
      expect((await runtime.run({ action: 'click', selector: '#ready' }, { cwd: root })).ok).toBe(true);
      const assertion = await runtime.run({
        action: 'assert',
        assertion: { selector: '#state', textIncludes: 'verified', titleIncludes: 'BiMax', statusBelow: 400, noConsoleErrors: true },
      }, { cwd: root });
      if (!assertion.ok) throw new Error(`Browser assertion failed: ${JSON.stringify(assertion)}`);
      const screenshot = await runtime.run({ action: 'screenshot' }, { cwd: root });
      expect(screenshot.ok).toBe(true);
      expect(screenshot.screenshot && fs.existsSync(screenshot.screenshot)).toBe(true);
      const comparison = await runtime.run({
        action: 'compare', baseline: path.relative(root, screenshot.screenshot!),
      }, { cwd: root });
      expect(comparison.ok).toBe(true);
      expect((comparison.data as any).exactMatch).toBe(true);
      expect(fs.existsSync(path.join(root, '.bimax', 'browser', 'state.json'))).toBe(true);
    } finally {
      await runtime.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
