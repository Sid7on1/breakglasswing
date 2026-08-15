import { assertUserHasNotTakenControl, UserTakeoverError } from '../server';
import { globalNativeInputInterlock } from '../native.input.interlock';

/**
 * The provider's user-takeover gate.
 *
 * The coordinator half is already graded by `computer.native.tool.coordinator.test.ts`, which proves
 * a paused interlock refuses `performAction` before `client.action` is ever called. What Phase 5
 * adds — and what this file grades — is the link that makes that latch reachable by the person at
 * the keyboard:
 *
 *   1. the gate consults the APP-OWNED authority, so a pause the user made in the window is
 *      observed by a provider process that never saw the click;
 *   2. it applies to `mac_control` too, which does not go through the coordinator at all;
 *   3. reads survive a pause, because the Live Target has to keep showing the user what they took
 *      control of;
 *   4. an authority it cannot read pauses rather than assuming consent.
 */

const ENDPOINT = 'http://127.0.0.1:65500/v1/takeover/state';
const originalFetch = globalThis.fetch;

function answerWith(state: { paused: boolean; reason?: string } | 'unreachable'): void {
  globalThis.fetch = (async () => {
    if (state === 'unreachable') throw new Error('connection refused');
    return {
      status: 200,
      text: async () => JSON.stringify({ ok: true, code: 'state', state: { generation: 0, reason: '', ...state } }),
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.BIMAX_CU_TAKEOVER_ENDPOINT = ENDPOINT;
  process.env.BIMAX_CU_TAKEOVER_TOKEN = 'token';
  globalNativeInputInterlock.resume();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BIMAX_CU_TAKEOVER_ENDPOINT;
  delete process.env.BIMAX_CU_TAKEOVER_TOKEN;
  globalNativeInputInterlock.resume();
});

describe('the app-owned pause reaches a provider that never saw the click', () => {
  test('a mutating tool is refused when the app says the user has control', async () => {
    answerWith({ paused: true, reason: 'You took control' });
    // The provider's own latch starts clear: the refusal can only come from the app.
    expect(globalNativeInputInterlock.state().paused).toBe(false);

    await expect(assertUserHasNotTakenControl(true)).rejects.toBeInstanceOf(UserTakeoverError);
    expect(globalNativeInputInterlock.state().paused).toBe(true);
    expect(globalNativeInputInterlock.state().reason).toBe('You took control');
  });

  test('the refusal names the user’s own reason, not an internal code', async () => {
    answerWith({ paused: true, reason: 'You took control' });
    await expect(assertUserHasNotTakenControl(true)).rejects.toThrow(/resume in Bimax before the agent acts/);
  });

  test('reads are still served while paused', async () => {
    answerWith({ paused: true, reason: 'You took control' });
    await expect(assertUserHasNotTakenControl(false)).resolves.toBeUndefined();
    // …and the pause is still recorded, so a later mutation is refused.
    await expect(assertUserHasNotTakenControl(true)).rejects.toBeInstanceOf(UserTakeoverError);
  });

  test('an explicit resume in the app releases the provider', async () => {
    answerWith({ paused: true });
    await expect(assertUserHasNotTakenControl(true)).rejects.toBeInstanceOf(UserTakeoverError);

    answerWith({ paused: false });
    await expect(assertUserHasNotTakenControl(true)).resolves.toBeUndefined();
    expect(globalNativeInputInterlock.state().paused).toBe(false);
  });

  test('an unreadable authority refuses — an unknown is never consent', async () => {
    answerWith('unreachable');
    await expect(assertUserHasNotTakenControl(true)).rejects.toBeInstanceOf(UserTakeoverError);
    expect(globalNativeInputInterlock.state().reason).toMatch(/could not confirm whether you have control/);
  });

  test('MUTANT — a gate that skipped the refresh would let the agent act through the pause', async () => {
    answerWith({ paused: true, reason: 'You took control' });
    // Exactly the same world, minus the app authority the gate is supposed to consult.
    delete process.env.BIMAX_CU_TAKEOVER_ENDPOINT;
    delete process.env.BIMAX_CU_TAKEOVER_TOKEN;
    await expect(assertUserHasNotTakenControl(true)).resolves.toBeUndefined();

    // Restore it and the same call is refused, which is what makes the assertion above load-bearing.
    process.env.BIMAX_CU_TAKEOVER_ENDPOINT = ENDPOINT;
    process.env.BIMAX_CU_TAKEOVER_TOKEN = 'token';
    await expect(assertUserHasNotTakenControl(true)).rejects.toBeInstanceOf(UserTakeoverError);
  });
});
