import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { BrowserRuntime } from '../browser/browser.runtime';

const browserIt = process.env.BIMAX_BROWSER_E2E === '1' ? it : it.skip;

async function listenOnLoopback(server: http.Server): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPERM') {
        resolve(false);
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(true);
    });
  });
}

describe('BrowserRuntime end to end', () => {
  browserIt('navigates, interacts, asserts, diagnoses, and captures durable evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-e2e-'));
    const server = http.createServer((request, response) => {
      if (request.url === '/popup') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>BiMax Popup</title><main><button>Popup action</button></main>');
        return;
      }
      if (request.url === '/download') {
        const payload = Buffer.from('typed browser download fixture');
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="report.txt"',
          'content-length': String(payload.length),
        });
        response.end(payload);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>BiMax Browser Probe</title><main>
        <button id="ready" onclick="document.querySelector('#state').textContent='verified'">Run</button>
        <input id="name" aria-label="Name" value="old">
        <select id="choice" aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>
        <button id="confirm" onclick="if (confirm('Approve fixture?')) document.querySelector('#state').textContent='confirmed'">Confirm fixture</button>
        <button id="prompt" onclick="document.querySelector('#state').textContent='prompt:' + prompt('Fixture name?', 'old')">Prompt fixture</button>
        <a href="/download" download>Download report</a>
        <a href="/popup" target="_blank">Open popup</a>
        <p id="state">waiting</p></main>`);
    });
    // Some managed runners prohibit all loopback listeners. Treat only that explicit capability
    // denial as not applicable; normal release hosts still execute the complete Chromium path.
    if (!(await listenOnLoopback(server))) {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }
    const port = (server.address() as AddressInfo).port;
    const runtime = new BrowserRuntime();
    try {
      const nav = await runtime.run({ action: 'navigate', url: `http://127.0.0.1:${port}`, retries: 2 }, { cwd: root });
      if (!nav.ok) throw new Error(`Browser navigation failed: ${JSON.stringify(nav)}`);
      expect(nav.status).toBe(200);
      expect(nav.navigation).toMatchObject({
        kind: 'navigate', documentChanged: true,
        from: { tabRef: expect.any(String), documentRef: expect.any(String) },
        to: { tabRef: expect.any(String), documentRef: expect.any(String) },
      });
      expect(nav.navigation?.from.tabRef).toBe(nav.navigation?.to.tabRef);
      expect(nav.navigation?.from.documentRef).not.toBe(nav.navigation?.to.documentRef);
      const snapshot = await runtime.run({ action: 'snapshot' }, { cwd: root });
      if (!snapshot.ok) throw new Error(`Browser snapshot failed: ${JSON.stringify(snapshot)}`);
      const indexed = (snapshot.data as any).elements as Array<{ index: number; ref: string; name: string }>;
      expect(indexed.map(element => element.name)).toEqual(expect.arrayContaining(['Run', 'Name', 'Choice']));
      expect(indexed.every(element => element.ref.startsWith('bimax-browser-element-'))).toBe(true);
      const runRef = indexed.find(element => element.name === 'Run')!.ref;
      const staleNameRef = indexed.find(element => element.name === 'Name')!.ref;
      const clickedRun = await runtime.run({ action: 'click', elementRef: runRef }, { cwd: root });
      expect(clickedRun.ok).toBe(true);
      expect(clickedRun.summary).toContain('Mouse-clicked');
      expect((clickedRun.data as any).input).toEqual(expect.objectContaining({
        x: expect.any(Number), y: expect.any(Number), target: expect.stringContaining('button#ready'),
      }));
      const stale = await runtime.run({ action: 'type', elementRef: staleNameRef, text: 'wrong' }, { cwd: root });
      expect(stale.ok).toBe(false);
      expect(stale.summary).toContain('stale');
      const afterClick = (clickedRun.data as any).observation.elements as Array<{ ref: string; name: string }>;
      const nameRef = afterClick.find(element => element.name === 'Name')!.ref;
      const typed = await runtime.run({ action: 'type', elementRef: nameRef, text: 'BiMax' }, { cwd: root });
      expect(typed.ok).toBe(true);
      const afterType = (typed.data as any).observation.elements as Array<{ ref: string; name: string }>;
      const choiceRef = afterType.find(element => element.name === 'Choice')!.ref;
      const selected = await runtime.run({ action: 'select', elementRef: choiceRef, values: ['b'] }, { cwd: root });
      expect(selected.ok).toBe(true);

      // Trusted input cannot defer a JavaScript modal decision without deadlocking Chromium's
      // release acknowledgement. The runtime dismisses safely and returns a typed inspection
      // receipt instead of advertising accept/dismiss support that does not work live.
      const afterSelect = (selected.data as any).observation.elements as Array<{ ref: string; name: string }>;
      const confirmRef = afterSelect.find(element => element.name === 'Confirm fixture')!.ref;
      const openedConfirm = await runtime.run({ action: 'click', elementRef: confirmRef }, { cwd: root });
      expect(openedConfirm.ok).toBe(true);
      expect(openedConfirm.dialog).toMatchObject({
        dialogRef: expect.any(String), type: 'confirm', message: 'Approve fixture?',
        resolution: 'dismissed_safely',
        tabRef: openedConfirm.target!.tabRef, documentRef: openedConfirm.target!.documentRef,
      });
      const dialogs = await runtime.run({ action: 'dialogs' }, { cwd: root });
      expect((dialogs.data as any).dialogs).toHaveLength(1);

      const afterConfirmSnapshot = await runtime.run({ action: 'snapshot' }, { cwd: root });
      const afterConfirm = (afterConfirmSnapshot.data as any).elements as Array<{ ref: string; name: string }>;
      const promptRef = afterConfirm.find(element => element.name === 'Prompt fixture')!.ref;
      const openedPrompt = await runtime.run({ action: 'click', elementRef: promptRef }, { cwd: root });
      expect(openedPrompt.dialog).toMatchObject({
        type: 'prompt', defaultValue: 'old', resolution: 'dismissed_safely',
      });

      // Downloads are denied until one workspace destination/byte cap is armed, then finalized
      // from Chromium's GUID filename to a collision-safe typed receipt with a digest.
      const afterPromptSnapshot = await runtime.run({ action: 'snapshot' }, { cwd: root });
      const afterPrompt = (afterPromptSnapshot.data as any).elements as Array<{ ref: string; name: string }>;
      const downloadRef = afterPrompt.find(element => element.name === 'Download report')!.ref;
      const prepared = await runtime.run({
        action: 'download_prepare', path: 'downloads', maxBytes: 1024,
      }, { cwd: root });
      expect(prepared).toMatchObject({ ok: true, data: { prepared: { oneShot: true, maxBytes: 1024 } } });
      const triggeredDownload = await runtime.run({ action: 'click', elementRef: downloadRef }, { cwd: root });
      expect(triggeredDownload.ok).toBe(true);
      const recorded = await runtime.run({ action: 'downloads' }, { cwd: root });
      const download = (recorded.data as any).downloads[0] as { downloadRef: string };
      expect(download.downloadRef).toEqual(expect.any(String));
      const completed = await runtime.run({
        action: 'download_wait', downloadRef: download.downloadRef, timeout: 5000,
      }, { cwd: root });
      expect(completed.download).toMatchObject({
        state: 'completed', path: 'downloads/report.txt', receivedBytes: 30,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(fs.readFileSync(path.join(root, 'downloads', 'report.txt'), 'utf8'))
        .toBe('typed browser download fixture');

      // The permit was consumed by the first transfer. A second click without download_prepare
      // is denied by Chromium and creates neither a record nor another file.
      const afterFirstDownload = (triggeredDownload.data as any).observation.elements as Array<{ ref: string; name: string }>;
      const unarmedRef = afterFirstDownload.find(element => element.name === 'Download report')!.ref;
      const unarmed = await runtime.run({ action: 'click', elementRef: unarmedRef }, { cwd: root });
      expect(unarmed.ok).toBe(true);
      expect(((await runtime.run({ action: 'downloads' }, { cwd: root })).data as any).downloads).toHaveLength(1);
      expect(fs.readdirSync(path.join(root, 'downloads'))).toEqual(['report.txt']);

      // A target=_blank popup gets a typed tab/document identity; selecting it is explicit.
      const afterDownload = (unarmed.data as any).observation.elements as Array<{ ref: string; name: string }>;
      const popupRef = afterDownload.find(element => element.name === 'Open popup')!.ref;
      expect((await runtime.run({ action: 'click', elementRef: popupRef }, { cwd: root })).ok).toBe(true);
      const listed = await runtime.run({ action: 'tabs' }, { cwd: root });
      const tabs = (listed.data as any).tabs as Array<{ tabRef: string; documentRef: string; title: string; active: boolean }>;
      expect(tabs).toHaveLength(2);
      const popup = tabs.find(tab => tab.title === 'BiMax Popup')!;
      expect(popup.active).toBe(false);
      const switched = await runtime.run({ action: 'switch_tab', tabRef: popup.tabRef, documentRef: popup.documentRef }, { cwd: root });
      expect(switched.ok).toBe(true);
      expect(switched.target).toEqual({ tabRef: popup.tabRef, documentRef: popup.documentRef });
      const reloaded = await runtime.run({
        action: 'reload', tabRef: popup.tabRef, documentRef: popup.documentRef,
      }, { cwd: root });
      expect(reloaded.navigation).toMatchObject({ kind: 'reload', documentChanged: true });
      expect(reloaded.navigation?.to.documentRef).not.toBe(popup.documentRef);
      const staleDocument = await runtime.run({
        action: 'status', tabRef: popup.tabRef, documentRef: popup.documentRef,
      }, { cwd: root });
      expect(staleDocument.ok).toBe(false);
      expect(staleDocument.summary).toContain('documentRef is stale');
      expect((await runtime.run({
        action: 'close_tab', tabRef: popup.tabRef,
        documentRef: reloaded.navigation!.to.documentRef,
      }, { cwd: root })).ok).toBe(true);
      expect(((await runtime.run({ action: 'tabs' }, { cwd: root })).data as any).tabs).toHaveLength(1);
      expect((await runtime.run({ action: 'click', selector: '#ready' }, { cwd: root })).ok).toBe(true);
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
    if (!(await listenOnLoopback(server))) {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }
    const port = (server.address() as AddressInfo).port;
    const runtime = new BrowserRuntime();
    try {
      expect((await runtime.run({ action: 'navigate', url: `http://127.0.0.1:${port}` }, { cwd: root })).ok).toBe(true);

      // Progressive query: only elements matching the filter are indexed.
      const filtered = await runtime.run({ action: 'snapshot', filter: 'add row' }, { cwd: root });
      if (!filtered.ok) throw new Error(`Filtered browser snapshot failed: ${JSON.stringify(filtered)}`);
      const filteredElements = (filtered.data as any).elements as Array<{ index: number; ref: string; name: string }>;
      expect(filteredElements).toHaveLength(1);
      expect(filteredElements[0].name).toBe('Add row');

      // Act from the filtered observation, then wait for the DELAYED DOM change (not a blind sleep).
      expect((await runtime.run({ action: 'click', elementRef: filteredElements[0].ref }, { cwd: root })).ok).toBe(true);
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
      const coordinateClick = await runtime.run({ action: 'click', x: 500, y: 500, normalized: true }, { cwd: root });
      expect(coordinateClick.ok).toBe(true);
      expect((coordinateClick.data as any).input).toEqual(expect.objectContaining({ x: 400, y: 300 }));
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
