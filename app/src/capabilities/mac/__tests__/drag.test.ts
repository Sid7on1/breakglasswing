import { DragMachine } from '../drag';

const from = { x: 10, y: 10 };
const to = { x: 200, y: 200 };

describe('DragMachine', () => {
  it('runs the full happy path in order and ends verified', () => {
    let t = 0;
    const m = new DragMachine(from, to, () => ++t);
    m.locateSource().verifySource(true).mouseDown().startDrag()
      .moveThrough([{ x: 50, y: 50 }, { x: 120, y: 120 }])
      .locateDestination().verifyDestination(true).mouseUp().verifyResult(true);
    expect(m.phase).toBe('verified');
    expect(m.ok).toBe(true);
    expect(m.done).toBe(true);
    expect(m.pointerDown).toBe(false);
    expect(m.trace.map(e => e.phase)).toEqual([
      'idle', 'source-located', 'source-verified', 'mouse-down', 'dragging', 'dragging',
      'destination-located', 'destination-verified', 'mouse-up', 'verified',
    ]);
  });

  it('holds the button down through the drag and reports it', () => {
    const m = new DragMachine(from, to);
    expect(m.pointerDown).toBe(false);
    m.locateSource().verifySource(true).mouseDown();
    expect(m.pointerDown).toBe(true);
    m.startDrag().moveThrough([{ x: 100, y: 100 }]);
    expect(m.pointerDown).toBe(true); // still held mid-drag
    m.locateDestination().verifyDestination(true).mouseUp();
    expect(m.pointerDown).toBe(false); // released
  });

  it('a cancel mid-drag reports that the button must be released (no stuck pointer)', () => {
    const m = new DragMachine(from, to);
    m.locateSource().verifySource(true).mouseDown().startDrag();
    expect(m.pointerDown).toBe(true);
    m.cancel('destination scrolled away');
    expect(m.phase).toBe('cancelled');
    expect(m.releaseOwed).toBe(true); // caller MUST post mouse-up
    expect(m.done).toBe(true);
    expect(m.ok).toBe(false);
  });

  it('a cancel before mouse-down owes no release', () => {
    const m = new DragMachine(from, to);
    m.locateSource().cancel();
    expect(m.phase).toBe('cancelled');
    expect(m.releaseOwed).toBe(false);
  });

  it('a failed source verification stops the drag before the button ever goes down', () => {
    const m = new DragMachine(from, to);
    m.locateSource().verifySource(false, 'file icon not at expected spot');
    expect(m.phase).toBe('failed');
    expect(m.pointerDown).toBe(false);
    expect(m.trace.at(-1)?.note).toMatch(/not at expected spot/);
  });

  it('a failed destination verification fails the drag (recoverable) without dropping blindly', () => {
    const m = new DragMachine(from, to);
    m.locateSource().verifySource(true).mouseDown().startDrag().locateDestination().verifyDestination(false);
    expect(m.phase).toBe('failed');
    // The button was still down when verification failed — the caller must release it. The machine's
    // pointerDown is false in 'failed', so the caller checks BEFORE reaching a terminal fail; here we
    // assert the invariant that a real drop was never issued (phase never reached mouse-up).
    expect(m.trace.some(e => e.phase === 'mouse-up')).toBe(false);
  });

  it('rejects illegal transitions (mis-sequenced drag is a bug, not a stuck button)', () => {
    const m = new DragMachine(from, to);
    expect(() => m.mouseDown()).toThrow(/illegal drag transition idle → mouse-down/);
    m.locateSource().verifySource(true).mouseDown();
    expect(() => m.verifyResult(true)).toThrow(/illegal drag transition/);
  });
});
