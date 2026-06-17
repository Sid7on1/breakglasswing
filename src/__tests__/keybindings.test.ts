import {
  parseChord, matchChord, getBindings, chordLabel, listBindings,
  dispatchKey, CONTEXT_PRIORITY, KeyContext, KeyContextName,
} from '../cli/keybindings';

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

describe('keybinding context stack (dispatchKey)', () => {
  // Build the five-context stack the TUI uses, recording which context fired and letting the
  // test toggle each context active/inactive and decide whether it consumes the press.
  function makeStack(opts: {
    permission?: boolean; overlay?: boolean; search?: boolean;
    chatHandles?: (c: string, k: any) => boolean;
    globalHandles?: (c: string, k: any) => boolean;
    fired?: KeyContextName[];
  }): KeyContext[] {
    const fired = opts.fired ?? [];
    const rec = (name: KeyContextName, handle: (c: string, k: any) => boolean): KeyContext['handle'] =>
      (c, k) => { const consumed = handle(c, k); if (consumed) fired.push(name); return consumed; };
    return [
      // Deliberately out of priority order to prove dispatchKey sorts them itself.
      { name: 'global', active: true, handle: rec('global', opts.globalHandles ?? (() => false)) },
      { name: 'chat', active: true, handle: rec('chat', opts.chatHandles ?? (() => false)) },
      { name: 'search', active: !!opts.search, handle: rec('search', () => true) },
      { name: 'overlay', active: !!opts.overlay, handle: rec('overlay', () => true) },
      { name: 'permission', active: !!opts.permission, handle: rec('permission', () => true) },
    ];
  }

  it('exposes the priority order highest → lowest', () => {
    expect(CONTEXT_PRIORITY).toEqual(['permission', 'overlay', 'search', 'chat', 'global']);
  });

  it('a modal veto (permission) swallows every press before any lower context', () => {
    const fired: KeyContextName[] = [];
    const consumed = dispatchKey('f', { ctrl: true }, makeStack({
      permission: true, globalHandles: () => true, fired,
    }));
    expect(consumed).toBe('permission');
    expect(fired).toEqual(['permission']); // global never ran
  });

  it('an open menu (overlay) outranks search/chat/global', () => {
    const fired: KeyContextName[] = [];
    const consumed = dispatchKey('x', {}, makeStack({ overlay: true, search: true, fired }));
    expect(consumed).toBe('overlay');
    expect(fired).toEqual(['overlay']);
  });

  it('search mode consumes keys before the chat editor and global chords', () => {
    const fired: KeyContextName[] = [];
    const consumed = dispatchKey('a', {}, makeStack({
      search: true, chatHandles: () => true, globalHandles: () => true, fired,
    }));
    expect(consumed).toBe('search');
    expect(fired).toEqual(['search']);
  });

  it('a chat editing key (e.g. Tab) is handled before the global chords', () => {
    const fired: KeyContextName[] = [];
    const consumed = dispatchKey('', { tab: true }, makeStack({
      chatHandles: (_c, k) => !!k.tab, globalHandles: () => true, fired,
    }));
    expect(consumed).toBe('chat');
    expect(fired).toEqual(['chat']);
  });

  it('a global chord fires only after chat declines the press (fall-through preserved)', () => {
    const fired: KeyContextName[] = [];
    const keys = getBindings();
    // Ctrl+F is the search chord; chat declines it, so global must catch it.
    const consumed = dispatchKey('f', { ctrl: true }, makeStack({
      chatHandles: () => false,
      globalHandles: (c, k) => matchChord(c, k, keys.search),
      fired,
    }));
    expect(consumed).toBe('global');
    expect(fired).toEqual(['global']);
  });

  it('returns null when the press falls through every active context (plain typing)', () => {
    const consumed = dispatchKey('q', {}, makeStack({
      chatHandles: () => false, globalHandles: () => false,
    }));
    expect(consumed).toBeNull();
  });

  it('skips inactive contexts entirely', () => {
    const fired: KeyContextName[] = [];
    // permission/overlay/search all OFF → press reaches global.
    const consumed = dispatchKey('t', { ctrl: true }, makeStack({
      globalHandles: () => true, fired,
    }));
    expect(consumed).toBe('global');
    expect(fired).toEqual(['global']);
  });
});
