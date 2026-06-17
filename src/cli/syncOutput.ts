import type { Writable } from 'stream';

// Synchronized output (DEC mode 2026, "BSU/ESU"). Terminals that support it (iTerm2, Kitty,
// WezTerm, Ghostty, recent VTE) hold the screen steady while an update is in progress and paint it
// in ONE atomic flip — eliminating the mid-repaint flicker/tearing you get when Ink erases the old
// frame and draws the new one in separate writes. We wrap each stdout chunk Ink emits in
// BSU…ESU. This is OPT-IN + feature-gated: off unless BGW_SYNC_OUTPUT is truthy AND the terminal
// looks capable, so the default path is byte-identical to today on every terminal.

export const BSU = '\x1b[?2026h'; // Begin Synchronized Update
export const ESU = '\x1b[?2026l'; // End Synchronized Update

/** Truthy-string check for the opt-in env flag. */
export function syncOutputEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.BGW_SYNC_OUTPUT || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Best-effort detection of terminals known to support DEC 2026. Conservative: unknown terminals
 * return false so we never send escapes a terminal might render as visible garbage. (There is no
 * portable synchronous query for 2026, so we allow-list by $TERM_PROGRAM / known env markers.)
 */
export function terminalSupportsSync(env: NodeJS.ProcessEnv = process.env): boolean {
  const prog = (env.TERM_PROGRAM || '').toLowerCase();
  if (prog === 'iterm.app' || prog === 'wezterm' || prog === 'ghostty') return true;
  if (env.KITTY_WINDOW_ID) return true;               // Kitty
  if (env.WEZTERM_PANE) return true;                  // WezTerm (alt marker)
  if ((env.TERM || '').includes('kitty')) return true;
  return false;
}

/** Should we actually wrap frames? Opt-in flag AND a capable terminal. */
export function shouldSyncOutput(env: NodeJS.ProcessEnv = process.env): boolean {
  return syncOutputEnabled(env) && terminalSupportsSync(env);
}

/**
 * Wrap a frame chunk in BSU/ESU. Empty chunks pass through untouched (nothing to synchronize), so
 * we never emit a bare BSU…ESU pair around nothing. Pure.
 */
export function wrapFrame(chunk: string): string {
  if (!chunk) return chunk;
  return BSU + chunk + ESU;
}

/**
 * Return a stdout-like object that brackets every write in BSU/ESU, delegating everything else to
 * the real stream (so `.columns`, `.rows`, `.on`, Ink's resize handling, etc. keep working). When
 * sync output isn't active this returns the original stream unchanged — zero overhead, zero risk.
 */
export function makeSyncStdout(real: Writable & { columns?: number; rows?: number }, env: NodeJS.ProcessEnv = process.env): Writable {
  if (!shouldSyncOutput(env)) return real;
  return new Proxy(real, {
    get(target: any, prop) {
      if (prop === 'write') {
        return (chunk: any, ...rest: any[]) => {
          const s = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? chunk;
          return target.write(typeof s === 'string' ? wrapFrame(s) : chunk, ...rest);
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
