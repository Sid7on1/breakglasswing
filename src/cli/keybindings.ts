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

// ────────────────────────────────────────────────────────────────────────────
// Keybinding context stack
//
// The TUI's input handler used to be one long flat list of `if` checks. The order
// of those checks silently encoded a priority: a modal veto/menu swallowed all keys,
// then search mode, then in-place chat editing (tab/arrows/escape), and finally the
// global action chords. That ordering was load-bearing but invisible — easy to break
// by reordering an `if`.
//
// `dispatchKey` makes the priority explicit: an ordered stack of contexts, each of
// which can be inactive (skipped) or consume the press (stop). It is deliberately
// ADDITIVE — every existing chord lives in the Global context unchanged, and the
// stack ordering reproduces the old fall-through exactly:
//   Permission (modal veto) → Overlay (menu) → Search → Chat (editing) → Global (chords)
// ────────────────────────────────────────────────────────────────────────────

/** Stable identifiers for the input contexts, highest-priority first. */
export type KeyContextName = 'permission' | 'overlay' | 'search' | 'chat' | 'global';

/** Highest → lowest priority. The dispatcher walks this order. */
export const CONTEXT_PRIORITY: KeyContextName[] = ['permission', 'overlay', 'search', 'chat', 'global'];

export interface KeyContext {
  name: KeyContextName;
  /** When false the context is skipped entirely (e.g. search context off when not searching). */
  active: boolean;
  /** Handle the press. Return true to CONSUME it (dispatch stops); false to pass through. */
  handle: (char: string, key: any) => boolean;
}

/**
 * Resolve a key press through the context stack. Contexts are sorted by CONTEXT_PRIORITY
 * (so callers may pass them in any order), inactive ones are skipped, and the first one
 * whose handler consumes the press wins. Returns the consuming context's name, or null if
 * the press fell through every context (e.g. a printable char that just edits the input).
 */
export function dispatchKey(char: string, key: any, contexts: KeyContext[]): KeyContextName | null {
  const ordered = [...contexts].sort(
    (a, b) => CONTEXT_PRIORITY.indexOf(a.name) - CONTEXT_PRIORITY.indexOf(b.name),
  );
  for (const ctx of ordered) {
    if (!ctx.active) continue;
    if (ctx.handle(char, key)) return ctx.name;
  }
  return null;
}
