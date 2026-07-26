import { classifyVerification, verifyClipboard } from '../computer/verification';

const base = { ok: true, hadScreenshot: true, expectedApp: 'Notes', actualApp: 'Notes', targetWindowId: 7, actualWindowId: 7 };

describe('classifyVerification — never trust the driver, judge the screen', () => {
  it('failed when the driver reports failure', () => {
    expect(classifyVerification({ ...base, ok: false }).outcome).toBe('failed');
  });

  it('wrong-window when a different app is in front', () => {
    const r = classifyVerification({ ...base, actualApp: 'Terminal' });
    expect(r.outcome).toBe('wrong-window');
    expect(r.windowStable).toBe(false);
  });

  it('wrong-window when a different window id is observed', () => {
    expect(classifyVerification({ ...base, actualWindowId: 99 }).outcome).toBe('wrong-window');
  });

  it('unverified when there is no fresh screenshot', () => {
    expect(classifyVerification({ ...base, hadScreenshot: false, nextFrameHash: undefined }).outcome).toBe('unverified');
  });

  it('confirmed when a semantic query matched', () => {
    expect(classifyVerification({ ...base, nextFrameHash: 'b', prevFrameHash: 'a', queryMatched: true }).outcome).toBe('confirmed');
  });

  it('distinguishes an explicit missed postcondition from an arbitrary pixel change', () => {
    const r = classifyVerification({
      ...base, prevFrameHash: 'before', nextFrameHash: 'after', queryMatched: false, queryRequired: true,
    });
    expect(r.outcome).toBe('expectation-missed');
    expect(r.frameChanged).toBe(true);
  });

  it('no-change when the post-action frame is identical (driver "succeeded" but nothing happened)', () => {
    const r = classifyVerification({ ...base, prevFrameHash: 'same', nextFrameHash: 'same' });
    expect(r.outcome).toBe('no-change');
    expect(r.frameChanged).toBe(false);
  });

  it('changed when the frame differs from before', () => {
    const r = classifyVerification({ ...base, prevFrameHash: 'a', nextFrameHash: 'b' });
    expect(r.outcome).toBe('changed');
    expect(r.frameChanged).toBe(true);
  });

  it('changed (no baseline) on the first captured frame', () => {
    const r = classifyVerification({ ...base, prevFrameHash: undefined, nextFrameHash: 'first' });
    expect(r.outcome).toBe('changed');
    expect(r.frameChanged).toBe(false);
    expect(r.note).toMatch(/no prior frame/i);
  });
});

describe('verifyClipboard', () => {
  it('exact match (whitespace/case-insensitive)', () => {
    expect(verifyClipboard('Hello World', '  hello   world ').ok).toBe(true);
  });
  it('containment either direction', () => {
    expect(verifyClipboard('sentence', 'a longer sentence here').ok).toBe(true);
    expect(verifyClipboard('a longer sentence here', 'sentence').ok).toBe(true);
  });
  it('mismatch', () => {
    expect(verifyClipboard('apples', 'oranges').ok).toBe(false);
  });
  it('nothing expected', () => {
    expect(verifyClipboard('', 'anything').ok).toBe(false);
  });
});
