// Terminal notifications — ported from Claude Code's src/ink/useTerminalNotification.ts
// and src/ink/termio/osc.ts, adapted to BiMax's plain-function style (no React context).
//
// These are TERMINAL features (OSC escape sequences), entirely model-agnostic: they work
// the same regardless of which LLM the agent is driving. We auto-detect the terminal and
// emit the matching protocol, falling back to a plain BEL.

const ESC = '\x1b';
const BEL = '\x07';
const ST = ESC + '\\'; // String Terminator
const OSC_PREFIX = ESC + ']';

// OSC command numbers (subset we use).
const OSC_ITERM2 = 9; // iTerm2 proprietary (also used for OSC 9;4 progress)
const OSC_KITTY = 99; // Kitty notification protocol
const OSC_GHOSTTY = 777; // Ghostty notification protocol

// iTerm2 OSC 9 subcommands + progress operation codes.
const ITERM2_PROGRESS = 4;
const PROGRESS = { CLEAR: 0, SET: 1, ERROR: 2, INDETERMINATE: 3 } as const;

/** Build an OSC sequence: ESC ] p1;p2;...;pN <terminator>.
 *  Kitty prefers ST (avoids audible beeps); everyone else gets BEL. */
function osc(parts: (string | number)[], kitty = false): string {
  const terminator = kitty ? ST : BEL;
  return `${OSC_PREFIX}${parts.join(';')}${terminator}`;
}

/**
 * Wrap an escape sequence for terminal-multiplexer passthrough. tmux/screen
 * intercept escape sequences; DCS passthrough tunnels them to the outer terminal.
 * tmux 3.3+ gates this behind `allow-passthrough` (default off) — when off, tmux
 * silently drops the DCS (no junk). Never wrap a bare BEL (would lose tmux's bell-action).
 */
export function wrapForMultiplexer(sequence: string): string {
  if (process.env['TMUX']) {
    const escaped = sequence.replaceAll(ESC, ESC + ESC);
    return `${ESC}Ptmux;${escaped}${ST}`;
  }
  if (process.env['STY']) {
    return `${ESC}P${sequence}${ST}`;
  }
  return sequence;
}

type Terminal = 'iterm2' | 'kitty' | 'ghostty' | 'unknown';

/** Best-effort detection of the host terminal from environment variables. */
function detectTerminal(): Terminal {
  const tp = process.env['TERM_PROGRAM'];
  if (tp === 'iTerm.app' || process.env['LC_TERMINAL'] === 'iTerm2') return 'iterm2';
  if (tp === 'ghostty' || process.env['GHOSTTY_RESOURCES_DIR']) return 'ghostty';
  if (process.env['KITTY_WINDOW_ID'] || process.env['TERM'] === 'xterm-kitty') return 'kitty';
  return 'unknown';
}

function write(seq: string): void {
  try { process.stdout.write(seq); } catch { /* stdout may be closed during shutdown */ }
}

let kittyNotifId = 1;

/**
 * Emit a desktop notification through whichever terminal protocol is available,
 * always falling back to a BEL so something happens even on unknown terminals.
 */
export function notify(opts: { title?: string; message: string }): void {
  const { title, message } = opts;
  switch (detectTerminal()) {
    case 'iterm2': {
      const display = title ? `${title}:\n${message}` : message;
      write(wrapForMultiplexer(osc([OSC_ITERM2, `\n\n${display}`])));
      break;
    }
    case 'kitty': {
      const id = kittyNotifId++;
      write(wrapForMultiplexer(osc([OSC_KITTY, `i=${id}:d=0:p=title`, title ?? 'BiMax'], true)));
      write(wrapForMultiplexer(osc([OSC_KITTY, `i=${id}:p=body`, message], true)));
      write(wrapForMultiplexer(osc([OSC_KITTY, `i=${id}:d=1:a=focus`, ''], true)));
      break;
    }
    case 'ghostty': {
      write(wrapForMultiplexer(osc([OSC_GHOSTTY, 'notify', title ?? 'BiMax', message])));
      break;
    }
    default:
      // Unknown terminal: a bell is the most we can portably do.
      break;
  }
  // Always ring the bell too — inside tmux this sets the window's bell flag.
  // Raw, unwrapped (wrapping would hide it from tmux's bell-action).
  bell();
}

/** Raw BEL. Inside tmux this triggers the bell-action; must not be DCS-wrapped. */
export function bell(): void {
  write(BEL);
}

type ProgressState = 'running' | 'completed' | 'error' | 'indeterminate';

// Progress reporting (OSC 9;4) is only honored by some terminals (iTerm2 3.6.6+,
// Ghostty 1.2.0+, ConEmu). Emitting elsewhere is harmless (discarded) but pointless.
function isProgressReportingAvailable(): boolean {
  const t = detectTerminal();
  return t === 'iterm2' || t === 'ghostty';
}

/**
 * Report task progress to the terminal via OSC 9;4. `percentage` is 0–100.
 * Pass state=null to clear the progress indicator.
 */
export function progress(state: ProgressState | null, percentage?: number): void {
  if (!isProgressReportingAvailable()) return;
  if (!state) {
    write(wrapForMultiplexer(osc([OSC_ITERM2, ITERM2_PROGRESS, PROGRESS.CLEAR, ''])));
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round(percentage ?? 0)));
  switch (state) {
    case 'completed':
      write(wrapForMultiplexer(osc([OSC_ITERM2, ITERM2_PROGRESS, PROGRESS.CLEAR, ''])));
      break;
    case 'error':
      write(wrapForMultiplexer(osc([OSC_ITERM2, ITERM2_PROGRESS, PROGRESS.ERROR, pct])));
      break;
    case 'indeterminate':
      write(wrapForMultiplexer(osc([OSC_ITERM2, ITERM2_PROGRESS, PROGRESS.INDETERMINATE, ''])));
      break;
    case 'running':
      write(wrapForMultiplexer(osc([OSC_ITERM2, ITERM2_PROGRESS, PROGRESS.SET, pct])));
      break;
  }
}
