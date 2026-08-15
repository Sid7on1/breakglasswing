import { globalNativeInputInterlock, type NativeInputInterlock } from './native.input.interlock';

/**
 * Provider-side mirror of the app-owned user takeover latch.
 *
 * `main/takeover.ts` owns the state the user actually controls. This module is the *only* thing in
 * the provider that writes to `NativeInputInterlock`, so there is still exactly one latch and
 * exactly one owner — the interlock keeps doing what it already did (refuse native mutations), it
 * just now learns the answer from the app instead of from a command that no longer exists.
 *
 * Two properties matter more than speed:
 *
 *  - **Fail closed.** If the endpoint is configured but cannot be read, we do not know whether the
 *    human has taken control, and `08_ACCEPTANCE_GATES.md` forbids reporting an unknown as fine.
 *    An unreachable authority pauses the interlock rather than clearing it.
 *  - **No polling.** The refresh happens once, inline, immediately before a mutating tool would
 *    otherwise cross the bridge. There is no timer, so an idle app does no work at all.
 *
 * With no endpoint configured (unit tests, the standalone provider probe, a dev run without the
 * Electron host) the module is inert and the interlock behaves exactly as before.
 */

export const TAKEOVER_ENDPOINT_ENV = 'BIMAX_CU_TAKEOVER_ENDPOINT';
export const TAKEOVER_TOKEN_ENV = 'BIMAX_CU_TAKEOVER_TOKEN';
/**
 * Set by Electron main for every Desktop-hosted provider, whether or not the broker started.
 *
 * This is the difference between "no host owns takeover, so the latch is inert" (a unit test, the
 * stdio contract probe, a bare provider run) and "a host that OWES a takeover authority failed to
 * supply one". The second case must not act on the user's Mac: if Bimax cannot promise the user can
 * take control, it has no business clicking anything.
 */
export const TAKEOVER_REQUIRED_ENV = 'BIMAX_CU_TAKEOVER_REQUIRED';

const REQUEST_TIMEOUT_MS = 1_500;

export interface TakeoverAuthorityConfig {
  endpoint?: string;
  token?: string;
  /** The host declared that a takeover authority is mandatory for this run. */
  required?: boolean;
}

export interface TakeoverRefreshResult {
  /** False only when no authority is configured at all. */
  configured: boolean;
  /** True when the authority answered this refresh. */
  reachable: boolean;
  paused: boolean;
  /** Electron main's monotonic generation, when the authority answered. */
  generation?: number;
  reason: string;
}

export type AuthorityFetch = (
  endpoint: string,
  body: string,
  timeoutMs: number,
) => Promise<{ status: number; text: string }>;

const defaultFetch: AuthorityFetch = async (endpoint, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

export function readTakeoverConfig(
  env: Record<string, string | undefined> = process.env,
): TakeoverAuthorityConfig {
  const endpoint = env[TAKEOVER_ENDPOINT_ENV];
  const token = env[TAKEOVER_TOKEN_ENV];
  return {
    ...(typeof endpoint === 'string' && endpoint ? { endpoint } : {}),
    ...(typeof token === 'string' && token ? { token } : {}),
    ...(env[TAKEOVER_REQUIRED_ENV] === '1' ? { required: true } : {}),
  };
}

/**
 * Ask the app what the user decided, then apply it to the interlock.
 *
 * The interlock is only written when the answer differs from what it already holds, so a resumed
 * session does not churn its generation on every tool call.
 */
export async function refreshTakeoverAuthority(
  config: TakeoverAuthorityConfig = readTakeoverConfig(),
  interlock: NativeInputInterlock = globalNativeInputInterlock,
  request: AuthorityFetch = defaultFetch,
): Promise<TakeoverRefreshResult> {
  if (!config.endpoint || !config.token) {
    // A host that declared the authority mandatory and then did not supply one is the
    // broker-failed-to-start case. Fail closed: mutations stop, reads keep working.
    if (config.required) {
      const reason = 'Bimax could not set up the control you would use to take over, so it will not act on your Mac';
      if (!interlock.state().paused || interlock.state().reason !== reason) interlock.pause(reason);
      return { configured: true, reachable: false, paused: true, reason };
    }
    const state = interlock.state();
    return { configured: false, reachable: false, paused: state.paused, reason: state.reason ?? '' };
  }

  let paused: boolean;
  let reason: string;
  let reachable: boolean;
  try {
    const response = await request(
      config.endpoint,
      JSON.stringify({ token: config.token }),
      REQUEST_TIMEOUT_MS,
    );
    const parsed = response.status === 200 ? JSON.parse(response.text) as {
      ok?: unknown; state?: { paused?: unknown; generation?: unknown; reason?: unknown };
    } : null;
    if (!parsed || parsed.ok !== true || typeof parsed.state?.paused !== 'boolean'
        || !Number.isSafeInteger(parsed.state.generation) || (parsed.state.generation as number) < 0) {
      throw new Error(`takeover authority answered ${response.status}`);
    }
    reachable = true;
    paused = parsed.state.paused;
    reason = typeof parsed.state.reason === 'string' ? parsed.state.reason : '';
    const generation = parsed.state.generation as number;
    interlock.synchronizeAuthority({ paused, generation, reason });
    return { configured: true, reachable, paused, generation, reason };
  } catch (error) {
    // Fail closed: an authority we cannot read is not an authority that said "go ahead".
    reachable = false;
    paused = true;
    reason = `the app could not confirm whether you have control (${String((error as Error)?.message || error)})`;
  }

  const current = interlock.state();
  if (paused && (!current.paused || current.reason !== reason)) interlock.pause(reason);
  return { configured: true, reachable, paused, reason };
}

export class TakeoverDeliveryError extends Error {
  public constructor(
    public readonly code: 'computer_use_paused' | 'computer_use_takeover_intervened',
    message: string,
  ) {
    super(message);
    this.name = 'TakeoverDeliveryError';
  }
}

/**
 * Per-action guard for the compatibility runtime's real delivery boundaries.
 *
 * `begin` binds the action to the authority generation current after approval/admission. Every
 * driver or fallback mutation calls `require` immediately before delivery. If main observed a
 * pause/resume between those points, the refreshed provider generation differs and the queued
 * action is discarded even though the final boolean is running again.
 */
export class TakeoverMutationGuard {
  private admissionGeneration: number | undefined;

  public constructor(private readonly interlock: NativeInputInterlock = globalNativeInputInterlock) {}

  public async begin(): Promise<void> {
    await refreshTakeoverAuthority(undefined, this.interlock);
    const state = this.interlock.state();
    this.assertRunning(state);
    this.admissionGeneration = state.generation;
  }

  public async require(): Promise<void> {
    await refreshTakeoverAuthority(undefined, this.interlock);
    const state = this.interlock.state();
    this.assertRunning(state);
    if (this.admissionGeneration !== undefined && state.generation !== this.admissionGeneration) {
      throw new TakeoverDeliveryError(
        'computer_use_takeover_intervened',
        'you took control while this action was being prepared; it was discarded — re-observe and act again',
      );
    }
  }

  public end(): void {
    this.admissionGeneration = undefined;
  }

  private assertRunning(state: ReturnType<NativeInputInterlock['state']>): void {
    if (!state.paused) return;
    throw new TakeoverDeliveryError(
      'computer_use_paused',
      `computer use is paused for user takeover${state.reason ? `: ${state.reason}` : ''}; explicit resume is required`,
    );
  }
}
