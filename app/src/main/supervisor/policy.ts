import { CrashKind, EnginePhase, ProfileId } from './types';

/**
 * Restart policy — bounded automatic recovery, pure and clock-injected. The supervisor asks two
 * questions after every death: WHAT was it (classifyExit) and WHAT NOW (decideRestart). Neither
 * touches timers or processes; the orchestrator applies the answers.
 */

export interface ExitFacts {
  code: number | null;
  signal: string | null;
  intentional: boolean;    // stop()/project switch/quit requested this death
  phase: EnginePhase;      // phase at the moment of death
  /** Watchdog verdicts override exit-status classification. */
  watchdog?: 'startup_timeout' | 'unresponsive' | 'protocol_failure';
  spawnError?: boolean;    // the process never came up (ENOENT etc.)
}

export function classifyExit(f: ExitFacts): CrashKind {
  if (f.intentional) return 'clean_shutdown';
  if (f.spawnError) return 'spawn_error';
  if (f.watchdog) return f.watchdog;
  // SIGKILL cannot come from the engine itself (it can't catch or send it to itself in any code
  // path we ship) — treat it as an external/resource termination, not an engine exception.
  if (f.signal === 'SIGKILL') return 'external_kill';
  if (f.signal) return 'crash';
  if (f.code === 0) return 'clean_shutdown';
  return 'crash';
}

/** One prior death, as the policy sees it. */
export interface CrashEvent {
  at: number;        // supervisor clock, ms
  kind: CrashKind;
  uptimeMs: number;
}

export interface PolicyConfig {
  maxAttempts: number;       // automatic restarts allowed inside the rolling window
  windowMs: number;          // the rolling window
  baseDelayMs: number;       // backoff base
  maxDelayMs: number;        // backoff cap
  jitterRatio: number;       // ± fraction of the delay
  stableMs: number;          // uptime past this resets the backoff ladder
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxAttempts: 5,
  windowMs: 10 * 60_000,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterRatio: 0.25,
  stableMs: 120_000,
};

export interface RestartDecision {
  restart: boolean;
  delayMs: number;
  /** Which consecutive automatic attempt this would be (1-based). */
  attempt: number;
  profile: ProfileId;
  reason: string; // 'auto_restart' | 'clean_shutdown' | 'budget_exhausted'
}

/**
 * Count the current run of restart-worthy crashes: walk history backwards while each crash is
 * inside the rolling window and did NOT follow a stable run. A crash whose uptime exceeded
 * stableMs ends the streak — the system had recovered, backoff restarts from scratch.
 */
export function consecutiveCrashes(history: CrashEvent[], now: number, cfg: PolicyConfig): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i];
    if (c.kind === 'clean_shutdown') break;
    if (now - c.at > cfg.windowMs) break;
    n++;
    if (c.uptimeMs >= cfg.stableMs) break; // this crash followed a stable run — streak ends here
  }
  return n;
}

/**
 * Progressive capability shedding: repeated resource-style deaths (SIGKILL, unresponsive under
 * memory pressure) step the next launch down the profile ladder instead of retrying the exact
 * configuration that just got the process killed.
 */
export function shedProfile(current: ProfileId, history: CrashEvent[], now: number, cfg: PolicyConfig): ProfileId {
  let resourceCrashes = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i];
    if (c.kind === 'clean_shutdown' || now - c.at > cfg.windowMs) break;
    if (c.kind === 'external_kill' || c.kind === 'unresponsive') resourceCrashes++;
  }
  if (resourceCrashes >= 2) return 'minimal';
  if (resourceCrashes >= 1) return current === 'minimal' ? 'minimal' : 'conservative';
  return current;
}

/**
 * Should we restart automatically, after how long, and with what profile? `history` must already
 * include the death being decided on. Deterministic given `random`.
 */
export function decideRestart(
  history: CrashEvent[],
  now: number,
  currentProfile: ProfileId,
  cfg: PolicyConfig,
  random: () => number,
): RestartDecision {
  const last = history[history.length - 1];
  const attempt = consecutiveCrashes(history, now, cfg);
  const profile = shedProfile(currentProfile, history, now, cfg);

  if (!last || last.kind === 'clean_shutdown') {
    return { restart: false, delayMs: 0, attempt, profile: currentProfile, reason: 'clean_shutdown' };
  }
  if (attempt > cfg.maxAttempts) {
    return { restart: false, delayMs: 0, attempt, profile, reason: 'budget_exhausted' };
  }
  const base = Math.min(cfg.baseDelayMs * 2 ** Math.max(0, attempt - 1), cfg.maxDelayMs);
  const jitter = 1 + cfg.jitterRatio * (random() * 2 - 1);
  const delayMs = Math.max(0, Math.round(base * jitter));
  return { restart: true, delayMs, attempt, profile, reason: 'auto_restart' };
}
