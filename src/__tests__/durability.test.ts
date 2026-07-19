import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActionHistory, sweepRecordings, writeSessionState, readSessionState, ComputerSessionState } from '../computer/durability';

describe('ActionHistory — bounded, compressed', () => {
  it('caps memory at `keep` while total keeps counting', () => {
    const h = new ActionHistory(3);
    for (let i = 0; i < 10; i++) h.record('click', { outcome: 'changed' });
    expect(h.size).toBe(3);   // only the newest 3 retained
    expect(h.total).toBe(10); // but the count is honest
  });

  it('summary compresses to counts + the last few, and reports the no-change streak', () => {
    const h = new ActionHistory();
    h.record('open', { app: 'Notes', outcome: 'changed' });
    h.record('click', { outcome: 'changed' });
    h.record('click', { outcome: 'no-change' });
    h.record('click', { outcome: 'no-change' });
    const s = h.summary(2);
    expect(s.total).toBe(4);
    expect(s.byAction).toEqual({ open: 1, click: 3 });
    expect(s.noChangeStreak).toBe(2);
    expect(s.recent).toHaveLength(2); // compressed — not the whole history
    expect(s.lastOutcome).toBe('no-change');
  });

  it('round-trips through JSON (for resume)', () => {
    const h = new ActionHistory();
    h.record('open', { app: 'Notes' });
    h.record('type');
    const restored = ActionHistory.fromJSON(h.toJSON());
    expect(restored.total).toBe(2);
    expect(restored.all().map(r => r.action)).toEqual(['open', 'type']);
  });

  it('resumes from a persisted summary — continues the count and keeps the recent trajectory', () => {
    const h = new ActionHistory();
    for (let i = 0; i < 20; i++) h.record('click', { outcome: 'changed' });
    h.record('type', { outcome: 'no-change' });
    const resumed = ActionHistory.fromSummary(h.summary(8));
    expect(resumed.total).toBe(21);                 // monotonic count survives the interruption
    resumed.record('key');                           // and the next action continues from there
    expect(resumed.total).toBe(22);
    expect(resumed.all().slice(-1)[0].action).toBe('key');
    expect(ActionHistory.fromSummary(null).total).toBe(0); // absent state → empty, never throws
  });
});

describe('sweepRecordings — bounded storage', () => {
  it('keeps only the newest N run folders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-rec-'));
    try {
      for (let i = 0; i < 8; i++) {
        const dir = path.join(root, `run-${i}`);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'frame.png'), 'x');
        fs.utimesSync(dir, new Date(1000 + i), new Date(1000 + i)); // ascending mtime
      }
      const removed = sweepRecordings(root, { keepRuns: 3 });
      expect(removed).toBe(5);
      const left = fs.readdirSync(root).filter(n => n.startsWith('run-')).sort();
      expect(left).toEqual(['run-5', 'run-6', 'run-7']); // newest three
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not throw on a missing directory', () => {
    expect(sweepRecordings('/no/such/dir')).toBe(0);
  });
});

describe('session state — durable resume', () => {
  it('atomically writes and reloads state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-state-'));
    const file = path.join(dir, 'session.json');
    try {
      const state: ComputerSessionState = {
        version: 1, updatedAt: Date.now(),
        surface: { id: 'native:42', kind: 'native-window', app: 'Notes', pid: 42, windowId: 7, focusOwner: 'agent' },
        history: { total: 3, kept: 3, byAction: { open: 1, type: 2 }, noChangeStreak: 0, recent: [] },
        recordingDir: '/tmp/rec',
      };
      writeSessionState(file, state);
      const loaded = readSessionState(file);
      expect(loaded?.surface?.app).toBe('Notes');
      expect(loaded?.history.byAction).toEqual({ open: 1, type: 2 });
      expect(fs.readdirSync(dir).some(n => n.endsWith('.tmp'))).toBe(false); // no temp left behind
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing or unversioned file', () => {
    expect(readSessionState('/no/such/session.json')).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-state-'));
    const file = path.join(dir, 's.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ version: 99 }));
      expect(readSessionState(file)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
