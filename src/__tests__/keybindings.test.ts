import { parseChord, matchChord, getBindings, chordLabel, listBindings } from '../cli/keybindings';

describe('keybindings', () => {
  it('parses chord specs', () => {
    expect(parseChord('ctrl+f')).toEqual({ ctrl: true, shift: false, meta: false, key: 'f' });
    expect(parseChord('shift+ctrl+x')).toEqual({ ctrl: true, shift: true, meta: false, key: 'x' });
    expect(parseChord('cmd+k')).toEqual({ ctrl: false, shift: false, meta: true, key: 'k' });
    expect(parseChord('')).toBeNull();
  });

  it('matches an Ink (char,key) press against a chord', () => {
    const chord = { ctrl: true, key: 'f' };
    expect(matchChord('f', { ctrl: true }, chord)).toBe(true);
    expect(matchChord('F', { ctrl: true }, chord)).toBe(true); // case-insensitive
    expect(matchChord('f', { ctrl: false }, chord)).toBe(false); // ctrl required
    expect(matchChord('g', { ctrl: true }, chord)).toBe(false);
  });

  it('falls back to defaults when config is unavailable', () => {
    // getConfig() throws when config isn't loaded → getBindings must still return the defaults.
    const b = getBindings();
    expect(b.search).toEqual({ ctrl: true, key: 'f' });
    expect(b.routeToggle).toEqual({ ctrl: true, key: 't' });
    expect(b.quit).toEqual({ ctrl: true, key: 'd' });
  });

  it('renders human-readable chord labels', () => {
    expect(chordLabel({ ctrl: true, key: 'f' })).toBe('Ctrl+F');
    expect(chordLabel({ ctrl: true, shift: true, key: 'x' })).toBe('Ctrl+Shift+X');
  });

  it('lists every action with a chord + label', () => {
    const rows = listBindings();
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.every(r => r.chord && r.label)).toBe(true);
    expect(rows.find(r => r.action === 'routeToggle')?.chord).toBe('Ctrl+T');
  });

  it('opens the command palette on Ctrl+G by default', () => {
    expect(getBindings().commandPalette).toEqual({ ctrl: true, key: 'g' });
  });

  // SimpleInput owns Ctrl+A/E/U/K/W for shell-style line editing; FullScreen's global chords must
  // stay disjoint from those, or a single keypress would both edit the line AND fire a shortcut
  // (e.g. the Ctrl+K palette/kill-end collision this guards against).
  it('no global Ctrl-chord collides with a SimpleInput shell edit (a/e/u/k/w)', () => {
    const SHELL_EDIT_KEYS = new Set(['a', 'e', 'u', 'k', 'w']);
    for (const { action, chord } of listBindings()) {
      const b = getBindings()[action as keyof ReturnType<typeof getBindings>];
      if (b.ctrl && !b.shift && !b.meta) {
        expect(SHELL_EDIT_KEYS.has(b.key.toLowerCase())).toBe(false);
      }
      expect(chord).toBeTruthy();
    }
  });
});
