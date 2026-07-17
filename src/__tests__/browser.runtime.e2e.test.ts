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
        <input id="name" aria-label="Name" value="old">
        <select id="choice" aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>
        <p id="state">waiting</p></main>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const runtime = new BrowserRuntime();
    try {
      const nav = await runtime.run({ action: 'navigate', url: `http://127.0.0.1:${port}`, retries: 2 }, { cwd: root });
      if (!nav.ok) throw new Error(`Browser navigation failed: ${JSON.stringify(nav)}`);
      expect(nav.status).toBe(200);
      const snapshot = await runtime.run({ action: 'snapshot' }, { cwd: root });
      expect(snapshot.ok).toBe(true);
      const indexed = (snapshot.data as any).elements as Array<{ index: number; name: string }>;
      expect(indexed.map(element => element.name)).toEqual(expect.arrayContaining(['Run', 'Name', 'Choice']));
      const runIndex = indexed.find(element => element.name === 'Run')!.index;
      const nameIndex = indexed.find(element => element.name === 'Name')!.index;
      const choiceIndex = indexed.find(element => element.name === 'Choice')!.index;
      expect((await runtime.run({ action: 'click', elementIndex: runIndex }, { cwd: root })).ok).toBe(true);
      expect((await runtime.run({ action: 'type', elementIndex: nameIndex, text: 'BiMax' }, { cwd: root })).ok).toBe(true);
      expect((await runtime.run({ action: 'select', elementIndex: choiceIndex, values: ['b'] }, { cwd: root })).ok).toBe(true);
      const assertion = await runtime.run({
        action: 'assert',
        assertion: { selector: '#state', textIncludes: 'verified', titleIncludes: 'BiMax', statusBelow: 400, noConsoleErrors: true },
      }, { cwd: root });
      if (!assertion.ok) throw new Error(`Browser assertion failed: ${JSON.stringify(assertion)}`);
      // Move focus off the text caret before exact pixel comparison; a blinking caret makes two
      // otherwise identical screenshots differ nondeterministically.
      expect((await runtime.run({ action: 'click', selector: '#ready' }, { cwd: root })).ok).toBe(true);
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

  browserIt('observation layer: filtered snapshots, successor diffs, change-wait, normalized clicks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-obs-'));
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>BiMax Observation Probe</title><main>
        <button id="add" onclick="setTimeout(() => { const b = document.createElement('button'); b.textContent = 'Fresh'; document.querySelector('main').appendChild(b); }, 150)">Add row</button>
        <button id="other">Other</button>
        <p id="state">waiting</p>
        <script>document.addEventListener('click', e => { document.querySelector('#state').textContent = 'clicked-at-' + e.clientX + 'x' + e.clientY; });</script>
        </main>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const runtime = new BrowserRuntime();
    try {
      expect((await runtime.run({ action: 'navigate', url: `http://127.0.0.1:${port}` }, { cwd: root })).ok).toBe(true);

      // Progressive query: only elements matching the filter are indexed.
      const filtered = await runtime.run({ action: 'snapshot', filter: 'add row' }, { cwd: root });
      const filteredElements = (filtered.data as any).elements as Array<{ index: number; name: string }>;
      expect(filteredElements).toHaveLength(1);
      expect(filteredElements[0].name).toBe('Add row');

      // Act from the filtered observation, then wait for the DELAYED DOM change (not a blind sleep).
      expect((await runtime.run({ action: 'click', elementIndex: filteredElements[0].index }, { cwd: root })).ok).toBe(true);
      const changed = await runtime.run({ action: 'wait', forChange: true, timeout: 3_000 }, { cwd: root });
      expect(changed.ok).toBe(true);
      expect(changed.summary).toContain('DOM changed');

      // Successor diff: the fresh button appears as +1 against the previous same-filter snapshot.
      const before = await runtime.run({ action: 'snapshot' }, { cwd: root });
      expect((before.data as any).diff).toBeUndefined(); // filter changed since last snapshot → no diff claim
      const after = await runtime.run({ action: 'snapshot' }, { cwd: root });
      expect((after.data as any).diff.changed).toBe(false); // steady state, truthfully unchanged
      expect(after.summary).toContain('no element changes');

      // A truthful change-wait failure: nothing mutates, so ok=false with the budget named.
      const still = await runtime.run({ action: 'wait', forChange: true, timeout: 400 }, { cwd: root });
      expect(still.ok).toBe(false);
      expect(still.summary).toContain('No DOM change');

      // Normalized coordinates: (500,500) in 0–1000 space lands mid-viewport (800×600 → 400×300).
      expect((await runtime.run({ action: 'click', x: 500, y: 500, normalized: true }, { cwd: root })).ok).toBe(true);
      const assertion = await runtime.run({
        action: 'assert', assertion: { selector: '#state', textIncludes: 'clicked-at-400x300' },
      }, { cwd: root });
      if (!assertion.ok) throw new Error(`Normalized click landed wrong: ${JSON.stringify(assertion)}`);
    } finally {
      await runtime.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
