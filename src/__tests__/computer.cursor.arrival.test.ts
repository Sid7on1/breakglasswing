import { DESKTOP_HELPER_SOURCE } from '../computer/helper.source';
import { DesktopRuntime } from '../computer/desktop.runtime';

/**
 * The cursor's arrival is measured, not assumed.
 *
 * Posting a mouse event hands it to the window server and returns; the reported cursor position
 * catches up milliseconds later. Measured on a 60-trial-per-variant probe, one-point hops: an
 * immediate read-back reports the PREVIOUS position 58/60 times, 2/55 after a 3ms wait, 0/60 after
 * 15ms — and posting the event twice does not help (59/60), so nothing is being dropped. That race
 * is what made the live endpoint check fail intermittently (1/10, then 13/200 across a longer run).
 *
 * These assert the PROPERTY — wait for arrival, then report what was observed — rather than the
 * specific timeout, so tuning the budget cannot silently reintroduce a move that returns early.
 */
describe('cursor arrival contract', () => {
  it('waits for the cursor to be observably at the point before the move returns', () => {
    expect(DESKTOP_HELPER_SOURCE).toContain('func settleCursor');
    // A bounded wait: it must poll the observed location and give up rather than hang when a user
    // is physically holding the mouse.
    expect(DESKTOP_HELPER_SOURCE).toMatch(/while waited < timeoutUs/);
    expect(DESKTOP_HELPER_SOURCE).toMatch(/CGEvent\(source: nil\)\?\.location/);
  });

  it('confirms arrival on both glide paths — the short hop and the eased path', () => {
    // The short-hop branch is where the failure was first seen, but the eased path's final sample
    // is subject to exactly the same lag, so a fix on only one branch would leave it half-closed.
    const glide = DESKTOP_HELPER_SOURCE.slice(
      DESKTOP_HELPER_SOURCE.indexOf('func glide('),
      DESKTOP_HELPER_SOURCE.indexOf('func frontmostName'),
    );
    expect(glide).not.toBe('');
    const settles = glide.match(/settleCursor\(at: target/g) || [];
    expect(settles.length).toBeGreaterThanOrEqual(2);
  });

  it('reports the position the cursor actually reached, and whether it is the requested one', () => {
    const move = DESKTOP_HELPER_SOURCE.slice(
      DESKTOP_HELPER_SOURCE.indexOf('case "move":'),
      DESKTOP_HELPER_SOURCE.indexOf('case "click":'),
    );
    expect(move).toContain('glide(to: p)');
    expect(move).toMatch(/\\"exact\\":/);
    // The reported point must come from a fresh read, never from the requested coordinates.
    expect(move).toMatch(/let at = CGEvent\(source: nil\)\?\.location/);
  });
});

describe('move verb honesty', () => {
  const runtimeWithHelper = (reply: any) => {
    const runtime = new DesktopRuntime();
    const helper = jest.fn(async () => reply);
    (runtime as any).helper = helper;
    (runtime as any).resolveHelper = () => '/tmp/bimax-desktop-test';
    return { runtime, helper };
  };

  it('reports a clean move plainly', async () => {
    const { runtime } = runtimeWithHelper({ ok: true, x: 301, y: 200, exact: true });
    const res = await runtime.run({ action: 'move', x: 301, y: 200 } as any, { cwd: '/tmp' });
    expect(res.ok).toBe(true);
    expect(res.summary).toBe('moved to 301,200');
  });

  it('says where the cursor really ended up when it did not reach the point', async () => {
    // The dangerous version of this is a summary that repeats the request back: everything
    // downstream then reasons about a cursor position that was never true.
    const { runtime } = runtimeWithHelper({ ok: true, x: 300, y: 200, exact: false });
    const res = await runtime.run({ action: 'move', x: 301, y: 200 } as any, { cwd: '/tmp' });
    expect(res.summary).toContain('ended at 300,200');
    expect(res.summary).not.toBe('moved to 301,200');
    expect(res.x).toBe(300);
    expect(res.y).toBe(200);
  });
});
