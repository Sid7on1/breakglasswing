/**
 * Serialized input executor tests.
 *
 * Two guarantees, both of which have real failure modes behind them:
 *  1. Native input actions never interleave. There is one physical mouse; overlapping actions do not
 *     run in parallel, they corrupt each other.
 *  2. A button the agent is physically holding is always accounted for, so an abort, an error, or a
 *     user takeover can release it. A stuck button outlives the process and breaks the human's mouse.
 */

import { InputExecutor, heldButtonFor } from '../input.executor';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('InputExecutor — serialization', () => {
  it('runs actions strictly in submission order, never interleaved', async () => {
    const exec = new InputExecutor();
    const events: string[] = [];

    const make = (name: string, delayMs: number) => exec.run(async () => {
      events.push(`${name}:start`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      events.push(`${name}:end`);
      return name;
    });

    // Submitted fastest-last on purpose: without serialization, C would finish before A even starts
    // its second half, and the events would interleave.
    const all = Promise.all([make('A', 30), make('B', 10), make('C', 0)]);
    await expect(all).resolves.toEqual(['A', 'B', 'C']);
    expect(events).toEqual([
      'A:start', 'A:end',
      'B:start', 'B:end',
      'C:start', 'C:end',
    ]);
  });

  it('lets a failing action reject its own caller without poisoning the queue', async () => {
    const exec = new InputExecutor();
    const order: string[] = [];

    const bad = exec.run(async () => { order.push('bad'); throw new Error('driver refused'); });
    const good = exec.run(async () => { order.push('good'); return 'ok'; });

    await expect(bad).rejects.toThrow('driver refused');
    // The critical part: the queue survived. One broken action must not wedge every later one.
    await expect(good).resolves.toBe('ok');
    expect(order).toEqual(['bad', 'good']);
  });

  it('reports queue depth so serialization is observable, not just claimed', async () => {
    const exec = new InputExecutor();
    expect(exec.queued).toBe(0);
    const slow = exec.run(async () => { await new Promise(r => setTimeout(r, 20)); });
    exec.run(async () => undefined);
    exec.run(async () => undefined);
    expect(exec.queued).toBe(3);
    await slow;
    await tick();
    expect(exec.peakQueued).toBe(3);
  });
});

describe('InputExecutor — held-button accounting', () => {
  it('tracks a held button and computes the compensating release', () => {
    const exec = new InputExecutor();
    expect(exec.hasHeldInput).toBe(false);

    exec.noteButtonDown('left', 400, 300);
    expect(exec.hasHeldInput).toBe(true);
    expect(exec.heldButtons()).toEqual([expect.objectContaining({ button: 'left', x: 400, y: 300 })]);

    // The release must be posted where the button went down, not wherever the pointer drifted to.
    const plan = exec.takeReleasePlan();
    expect(plan).toEqual([expect.objectContaining({ button: 'left', x: 400, y: 300 })]);
    // Taking the plan clears it: a release computed but never posted must not be recomputed forever.
    expect(exec.hasHeldInput).toBe(false);
    expect(exec.takeReleasePlan()).toEqual([]);
  });

  it('forgets a button released normally, so dispose owes nothing', () => {
    const exec = new InputExecutor();
    exec.noteButtonDown('left', 10, 10);
    exec.noteButtonUp('left');
    expect(exec.hasHeldInput).toBe(false);
    expect(exec.takeReleasePlan()).toEqual([]);
  });

  it('tracks several buttons independently and releases oldest first', () => {
    let now = 1000;
    const exec = new InputExecutor(() => now);
    exec.noteButtonDown('right', 1, 1);
    now += 50;
    exec.noteButtonDown('left', 2, 2);
    now += 50;
    exec.noteButtonDown('middle', 3, 3);

    expect(exec.heldButtons().map(h => h.button)).toEqual(['right', 'left', 'middle']);
    exec.noteButtonUp('left');
    expect(exec.heldButtons().map(h => h.button)).toEqual(['right', 'middle']);
  });

  it('releases everything owed when the user takes over mid-gesture', () => {
    const exec = new InputExecutor();
    exec.noteButtonDown('left', 500, 500);
    const owed = exec.pause('user moved the mouse');

    expect(owed).toEqual([expect.objectContaining({ button: 'left', x: 500, y: 500 })]);
    expect(exec.paused).toBe(true);
    expect(exec.pauseReason).toBe('user moved the mouse');
    // The desktop is neutral again — the human is not fighting a held button.
    expect(exec.hasHeldInput).toBe(false);

    exec.resume();
    expect(exec.paused).toBe(false);
  });

  it('surfaces what is still owed on reset so dispose can settle it', () => {
    const exec = new InputExecutor();
    exec.noteButtonDown('left', 7, 8);
    const owed = exec.reset();
    expect(owed).toEqual([expect.objectContaining({ button: 'left', x: 7, y: 8 })]);
    expect(exec.hasHeldInput).toBe(false);
    expect(exec.queued).toBe(0);
    expect(exec.paused).toBe(false);
  });

  it('maps verb button names onto tracked buttons, defaulting to left', () => {
    expect(heldButtonFor('right')).toBe('right');
    expect(heldButtonFor('middle')).toBe('middle');
    expect(heldButtonFor('left')).toBe('left');
    expect(heldButtonFor(undefined)).toBe('left');
    expect(heldButtonFor('nonsense')).toBe('left');
  });
});
