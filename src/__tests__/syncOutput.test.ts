import {
  BSU, ESU, syncOutputEnabled, terminalSupportsSync, shouldSyncOutput, wrapFrame, makeSyncStdout,
} from '../cli/syncOutput';

describe('syncOutputEnabled — opt-in flag', () => {
  it('is off unless BGW_SYNC_OUTPUT is truthy', () => {
    expect(syncOutputEnabled({} as any)).toBe(false);
    expect(syncOutputEnabled({ BGW_SYNC_OUTPUT: '0' } as any)).toBe(false);
    for (const v of ['1', 'true', 'yes', 'TRUE']) {
      expect(syncOutputEnabled({ BGW_SYNC_OUTPUT: v } as any)).toBe(true);
    }
  });
});

describe('terminalSupportsSync — conservative allow-list', () => {
  it('recognizes known-capable terminals', () => {
    expect(terminalSupportsSync({ TERM_PROGRAM: 'iTerm.app' } as any)).toBe(true);
    expect(terminalSupportsSync({ TERM_PROGRAM: 'WezTerm' } as any)).toBe(true);
    expect(terminalSupportsSync({ TERM_PROGRAM: 'ghostty' } as any)).toBe(true);
    expect(terminalSupportsSync({ KITTY_WINDOW_ID: '1' } as any)).toBe(true);
    expect(terminalSupportsSync({ TERM: 'xterm-kitty' } as any)).toBe(true);
  });
  it('is false for unknown terminals (never emit escapes blindly)', () => {
    expect(terminalSupportsSync({ TERM_PROGRAM: 'Apple_Terminal' } as any)).toBe(false);
    expect(terminalSupportsSync({} as any)).toBe(false);
  });
});

describe('shouldSyncOutput — both gates required', () => {
  it('needs the flag AND a capable terminal', () => {
    expect(shouldSyncOutput({ BGW_SYNC_OUTPUT: '1', TERM_PROGRAM: 'iTerm.app' } as any)).toBe(true);
    expect(shouldSyncOutput({ BGW_SYNC_OUTPUT: '1' } as any)).toBe(false);          // no terminal
    expect(shouldSyncOutput({ TERM_PROGRAM: 'iTerm.app' } as any)).toBe(false);     // no flag
  });
});

describe('wrapFrame', () => {
  it('brackets a non-empty chunk in BSU/ESU', () => {
    expect(wrapFrame('hi')).toBe(BSU + 'hi' + ESU);
  });
  it('passes an empty chunk through untouched (no bare BSU/ESU pair)', () => {
    expect(wrapFrame('')).toBe('');
  });
});

describe('makeSyncStdout', () => {
  it('returns the SAME stream untouched when sync is inactive', () => {
    const real: any = { write: jest.fn(), columns: 80 };
    expect(makeSyncStdout(real, {} as any)).toBe(real);
  });

  it('wraps writes (and preserves passthrough props) when active', () => {
    const written: string[] = [];
    const real: any = { write: (s: string) => { written.push(s); return true; }, columns: 120, rows: 40 };
    const wrapped = makeSyncStdout(real, { BGW_SYNC_OUTPUT: '1', TERM_PROGRAM: 'iTerm.app' } as any);
    expect(wrapped).not.toBe(real);
    (wrapped as any).write('frame');
    expect(written).toEqual([BSU + 'frame' + ESU]);
    // Non-write props pass through to the real stream.
    expect((wrapped as any).columns).toBe(120);
    expect((wrapped as any).rows).toBe(40);
  });
});
