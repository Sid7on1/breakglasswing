import {
  BrowserRuntime, BrowserCommand, BrowserCommandResult,
  isBrowserCrashError, browserActionKey,
} from '../browser/browser.runtime';

// Long-run hardening contracts, no browser launched: crash classification (what resets the
// runtime vs what is just a failed page action), action identity for the consecutive-failure
// memory, and the failure-loop nudge itself via a stubbed dispatch.

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
    expect(browserActionKey({ action: 'navigate', url: 'https://a.test' }))
      .not.toBe(browserActionKey({ action: 'navigate', url: 'https://b.test' }));
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
