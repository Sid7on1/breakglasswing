import { LoopDetector } from '../core/loop-detector';

describe('LoopDetector — interleaved repeats', () => {
  it('fires a hard signal when the SAME call recurs non-consecutively (the thrash bug)', () => {
    const d = new LoopDetector();
    // Model interleaves: read evaluator, then other files, then evaluator again, … never twice in a
    // row. The old "N-in-a-row" check missed this; the count-in-window check must catch it.
    const others = ['a.ts', 'b.ts', 'c.ts'];
    let hard = null as ReturnType<LoopDetector['record']>;
    for (let i = 0; i < 4; i++) {
      d.record('Read', JSON.stringify({ path: 'evaluator.ts' }), 'contents');
      const sig = d.record('Read', JSON.stringify({ path: others[i % others.length] }), 'contents');
      if (sig?.severity === 'hard') hard = sig; // a filler read should never be the hard trigger
    }
    // The 4th interleaved evaluator read is the hard stop.
    const last = d.record('Read', JSON.stringify({ path: 'evaluator.ts' }), 'contents');
    expect(last?.severity).toBe('hard');
    expect(last?.type).toBe('generic_repeat');
  });

  it('does not fire for a normal read → edit → re-read (2 identical reads)', () => {
    const d = new LoopDetector();
    expect(d.record('Read', '{"path":"x.ts"}', 'v1')).toBeNull();
    d.record('Edit', '{"path":"x.ts"}', 'ok');
    expect(d.record('Read', '{"path":"x.ts"}', 'v2')).toBeNull();
  });
});
