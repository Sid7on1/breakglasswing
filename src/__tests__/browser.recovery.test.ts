import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BrowserRuntime, BrowserCommand, BrowserCommandResult,
  isBrowserCrashError, browserActionKey, findBrowserExecutable,
} from '../browser/browser.runtime';

// Long-run hardening contracts, no browser launched: crash classification (what resets the
// runtime vs what is just a failed page action), action identity for the consecutive-failure
// memory, and the failure-loop nudge itself via a stubbed dispatch.

describe('managed browser selection', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('does not silently launch the user\'s installed Chrome', () => {
    delete process.env.BIMAX_BROWSER_EXECUTABLE;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowserExecutable()).toBeUndefined();
  });

  it('honors an explicit existing automation executable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-browser-path-'));
    const executable = path.join(dir, 'chromium');
    try {
      fs.writeFileSync(executable, '#!/bin/sh');
      process.env.BIMAX_BROWSER_EXECUTABLE = executable;
      expect(findBrowserExecutable()).toBe(executable);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isBrowserCrashError', () => {
  it.each([
    'Protocol error (Page.navigate): Target closed.',
    'Protocol error: Connection closed. Most likely the page has been closed.',
    'Session closed. Most likely the page has been closed.',
    'WebSocket is not open: readyState 3 (CLOSED)',
    'Navigating frame was detached',
    'Browser closed unexpectedly',
    'the browser has disconnected',
  ])('classifies "%s" as a crash', message => {
    expect(isBrowserCrashError(message)).toBe(true);
  });

  it.each([
    'Waiting for selector `#save` failed: 30000ms exceeded',
    'Navigation returned no response.',
    'net::ERR_NAME_NOT_RESOLVED at https://example.invalid',
    'elementIndex 4 is stale',
    'Node is either not clickable or not an Element',
  ])('does NOT classify the ordinary failure "%s" as a crash', message => {
    expect(isBrowserCrashError(message)).toBe(false);
  });
});

describe('browserActionKey', () => {
  it('is stable for the same attempt and ignores typed text content', () => {
    const a: BrowserCommand = { action: 'type', selector: '#q', text: 'first try' };
    const b: BrowserCommand = { action: 'type', selector: '#q', text: 'second try' };
    expect(browserActionKey(a)).toBe(browserActionKey(b));
  });

  it('separates different targets and different actions', () => {
    expect(browserActionKey({ action: 'click', selector: '#save' }))
      .not.toBe(browserActionKey({ action: 'click', selector: '#cancel' }));
    expect(browserActionKey({ action: 'click', elementIndex: 3 }))
      .not.toBe(browserActionKey({ action: 'hover', elementIndex: 3 }));
    expect(browserActionKey({ action: 'click', elementRef: 'observation-a' }))
      .not.toBe(browserActionKey({ action: 'click', elementRef: 'observation-b' }));
    expect(browserActionKey({ action: 'status', tabRef: 'tab', documentRef: 'document-a' }))
      .not.toBe(browserActionKey({ action: 'status', tabRef: 'tab', documentRef: 'document-b' }));
    expect(browserActionKey({ action: 'navigate', url: 'https://a.test' }))
      .not.toBe(browserActionKey({ action: 'navigate', url: 'https://b.test' }));
  });
});

describe('typed browser target preflight', () => {
  it('binds ordinary work to the active tab and exact current document', () => {
    const runtime = new BrowserRuntime() as any;
    const active = { isClosed: () => false };
    const other = { isClosed: () => false };
    runtime.page = active;
    runtime.pagesByTabRef.set('active-tab', active);
    runtime.pagesByTabRef.set('other-tab', other);
    runtime.documentRefs.set(active, 'active-document');
    runtime.documentRefs.set(other, 'other-document');

    expect(runtime.preflightTarget({
      action: 'status', tabRef: 'active-tab', documentRef: 'active-document',
    })).toEqual({ ok: true });
    expect(runtime.preflightTarget({
      action: 'status', tabRef: 'active-tab', documentRef: 'stale-document',
    })).toMatchObject({ ok: false, error: expect.stringMatching(/stale/) });
    expect(runtime.preflightTarget({ action: 'status', tabRef: 'other-tab' }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/not active/) });
    expect(runtime.preflightTarget({ action: 'switch_tab', tabRef: 'other-tab', documentRef: 'other-document' }))
      .toEqual({ ok: true });
  });

  it('blocks page work while an unhandled dialog is pending but permits typed inspection', () => {
    const runtime = new BrowserRuntime() as any;
    const active = { isClosed: () => false };
    runtime.page = active;
    runtime.pendingDialogs.set(active, {
      dialog: {},
      info: {
        tabRef: 'tab', documentRef: 'document', dialogRef: 'dialog', type: 'confirm',
        message: 'Approve?', openedAt: 1,
      },
    });
    expect(runtime.preflightTarget({ action: 'click', selector: '#behind' }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/dialog is blocking/) });
    expect(runtime.preflightTarget({ action: 'dialogs' })).toEqual({ ok: true });
  });
});

describe('bounded browser downloads', () => {
  it('finalizes a GUID-named Chromium transfer with a collision-safe path and digest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-download-unit-'));
    try {
      fs.writeFileSync(path.join(root, 'report.txt'), 'existing');
      fs.writeFileSync(path.join(root, 'guid-one'), 'fixture bytes');
      const runtime = new BrowserRuntime() as any;
      runtime.projectRoot = root;
      runtime.downloadSession = { send: jest.fn(async () => {}) };
      const record = {
        guid: 'guid-one', root, internalPath: path.join(root, 'guid-one'),
        info: {
          tabRef: 'tab', documentRef: 'document', downloadRef: 'download',
          url: 'https://example.test/report', suggestedFilename: 'report.txt',
          state: 'in_progress', receivedBytes: 0, maxBytes: 1000, startedAt: 1,
        },
      };
      runtime.downloadRecords.set('download', record);
      runtime.downloadRefsByGuid.set('guid-one', 'download');
      await runtime.updateDownloadProgress({
        guid: 'guid-one', totalBytes: 13, receivedBytes: 13, state: 'completed',
      });
      expect(record.info).toMatchObject({
        state: 'completed', path: 'report-2.txt', receivedBytes: 13,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/), completedAt: expect.any(Number),
      });
      expect(fs.readFileSync(path.join(root, 'report-2.txt'), 'utf8')).toBe('fixture bytes');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('cancels a transfer as soon as its declared or received bytes exceed the permit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-download-limit-'));
    try {
      fs.writeFileSync(path.join(root, 'guid-two'), 'too large');
      const send = jest.fn(async () => {});
      const runtime = new BrowserRuntime() as any;
      runtime.downloadSession = { send };
      const record = {
        guid: 'guid-two', root, internalPath: path.join(root, 'guid-two'),
        info: {
          tabRef: 'tab', documentRef: 'document', downloadRef: 'download',
          url: 'https://example.test/large', suggestedFilename: 'large.bin',
          state: 'in_progress', receivedBytes: 0, maxBytes: 4, startedAt: 1,
        },
      };
      runtime.downloadRecords.set('download', record);
      runtime.downloadRefsByGuid.set('guid-two', 'download');
      await runtime.updateDownloadProgress({
        guid: 'guid-two', totalBytes: 9, receivedBytes: 0, state: 'inProgress',
      });
      expect(record.info).toMatchObject({ state: 'canceled', error: expect.stringMatching(/exceeded/) });
      expect(send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'guid-two' });
      expect(fs.existsSync(path.join(root, 'guid-two'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('failure-loop memory', () => {
  const result = (ok: boolean): BrowserCommandResult => ({
    ok, action: 'click', summary: ok ? 'Clicked #save.' : 'Waiting for selector `#save` failed.',
    consoleErrors: [], failedRequests: [], attempts: 1, durationMs: 5,
  });

  function stubbedRuntime(outcomes: boolean[]): BrowserRuntime {
    const runtime = new BrowserRuntime();
    let call = 0;
    (runtime as any).dispatch = async () => result(outcomes[Math.min(call++, outcomes.length - 1)]);
    return runtime;
  }

  const click: BrowserCommand = { action: 'click', selector: '#save' };

  it('nudges after three consecutive identical failures', async () => {
    const runtime = stubbedRuntime([false, false, false]);
    await runtime.run(click);
    const second = await runtime.run(click);
    expect(second.summary).not.toContain('failed 2 times in a row');
    const third = await runtime.run(click);
    expect(third.summary).toContain('failed 3 times in a row');
    expect(third.summary).toContain('fresh snapshot');
  });

  it('keeps counting past the threshold', async () => {
    const runtime = stubbedRuntime([false, false, false, false]);
    for (let i = 0; i < 3; i++) await runtime.run(click);
    const fourth = await runtime.run(click);
    expect(fourth.summary).toContain('failed 4 times in a row');
  });

  it('a success clears the streak', async () => {
    const runtime = stubbedRuntime([false, false, true, false]);
    await runtime.run(click);
    await runtime.run(click);
    await runtime.run(click); // success — resets
    const next = await runtime.run(click);
    expect(next.summary).not.toContain('times in a row');
  });

  it('a different failing action restarts the count instead of inheriting it', async () => {
    const runtime = stubbedRuntime([false, false, false]);
    await runtime.run(click);
    await runtime.run(click);
    const other = await runtime.run({ action: 'click', selector: '#cancel' });
    expect(other.summary).not.toContain('times in a row');
  });
});
