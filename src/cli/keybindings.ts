import { getConfig } from './config';

/**
 * Centralized, user-rebindable key bindings for the TUI. The action shortcuts used to be
 * hardcoded as `char === 'f' && key.ctrl` checks scattered through FullScreen's useInput; this
 * collects them into one place with stable defaults that can be overridden from config
 * (`keybindings: { search: "ctrl+f", ... }`). Structural keys (arrows, enter, escape) stay in the
 * input handler — only the named action chords live here.
 */
export type KeyAction =
  | 'resumeStash'
  | 'search'
  | 'pastePreview'
  | 'toggleLogs'
  | 'routeToggle'
  | 'commandPalette'
  | 'quit'
  | 'interrupt';

export interface KeyChord { ctrl?: boolean; shift?: boolean; meta?: boolean; key: string; }

const DEFAULTS: Record<KeyAction, KeyChord> = {
  resumeStash: { ctrl: true, key: 'r' },
  search: { ctrl: true, key: 'f' },
  pastePreview: { ctrl: true, key: 'p' },
  toggleLogs: { ctrl: true, key: 'o' },
  routeToggle: { ctrl: true, key: 't' },
  commandPalette: { ctrl: true, key: 'g' },
  quit: { ctrl: true, key: 'd' },
  interrupt: { ctrl: true, key: 'c' },
};

export const ACTION_LABELS: Record<KeyAction, string> = {
  resumeStash: 'Resume stashed prompt',
  search: 'Search the logs',
  pastePreview: 'Preview pasted text',
  toggleLogs: 'Toggle the logs panel',
  routeToggle: 'Cycle model routing (auto → lite → heavy)',
  commandPalette: 'Open the command palette',
  quit: 'Quit bimax',
  interrupt: 'Interrupt / quit (press twice)',
};

/** Parse "ctrl+f" / "shift+ctrl+x" / "f" into a chord. Returns null if empty. */
export function parseChord(spec: string): KeyChord | null {
  const parts = spec.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts.pop()!;
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key,
  };
}

/** Current bindings = defaults merged with any valid config overrides. Cheap; reads cached config. */
export function getBindings(): Record<KeyAction, KeyChord> {
  const out: Record<KeyAction, KeyChord> = { ...DEFAULTS };
  try {
    const overrides = (getConfig() as any).keybindings;
    if (overrides && typeof overrides === 'object') {
      for (const action of Object.keys(DEFAULTS) as KeyAction[]) {
        const raw = overrides[action];
        if (typeof raw === 'string') {
          const chord = parseChord(raw);
          if (chord) out[action] = chord;
        }
      }
    }
  } catch { /* config not loaded yet → defaults */ }
  return out;
}

/** Does an Ink (char, key) press match a chord? */
export function matchChord(char: string, key: any, chord: KeyChord): boolean {
  if (!!chord.ctrl !== !!key?.ctrl) return false;
  if (chord.shift !== undefined && !!chord.shift !== !!key?.shift) return false;
  if (chord.meta !== undefined && !!chord.meta !== !!key?.meta) return false;
  return (char || '').toLowerCase() === chord.key.toLowerCase();
}

/** Human-readable chord, e.g. { ctrl:true, key:'f' } → "Ctrl+F". */
export function chordLabel(chord: KeyChord): string {
  const mods: string[] = [];
  if (chord.ctrl) mods.push('Ctrl');
  if (chord.shift) mods.push('Shift');
  if (chord.meta) mods.push('Cmd');
  return [...mods, chord.key.toUpperCase()].join('+');
}

/** All bindings as display rows (for the /keys command). */
export function listBindings(): { action: KeyAction; chord: string; label: string }[] {
  const b = getBindings();
  return (Object.keys(DEFAULTS) as KeyAction[]).map(a => ({ action: a, chord: chordLabel(b[a]), label: ACTION_LABELS[a] }));
}
