import { tailToHeight } from '../cli/streaming.viewport';

// Regression guard for the live-streaming duplication bug: the in-progress reply is
// rendered in Ink's dynamic (non-<Static>) region, which must stay shorter than the
// terminal viewport or Ink re-appends the whole frame on every token. tailToHeight is
// what keeps that region bounded by visual rows.
describe('tailToHeight', () => {
  it('returns the whole text untruncated when it fits', () => {
    const r = tailToHeight('a\nb\nc', 10, 80);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('a\nb\nc');
  });

  it('keeps only the trailing lines when over budget', () => {
    const r = tailToHeight('l1\nl2\nl3\nl4\nl5', 2, 80);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('l4\nl5');
  });

  it('counts soft-wrapped rows, not just newlines', () => {
    // One 200-char line wraps to 5 rows at width 40, blowing a 3-row budget.
    const longLine = 'x'.repeat(200);
    const r = tailToHeight(`short\n${longLine}`, 3, 40);
    expect(r.truncated).toBe(true);
    // The long line alone exceeds the budget, so the short line is dropped.
    expect(r.text).toBe(longLine);
  });

  it('never returns more visual rows than the budget allows (the core invariant)', () => {
    const width = 50;
    const text = Array.from({ length: 100 }, (_, i) => 'line-' + i + ' '.repeat(60)).join('\n');
    const budget = 12;
    const { text: out } = tailToHeight(text, budget, width);
    const rows = out.split('\n').reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / width)), 0);
    expect(rows).toBeLessThanOrEqual(budget);
  });

  it('always keeps at least one (the last) line even if it alone overflows', () => {
    const huge = 'z'.repeat(1000);
    const r = tailToHeight(huge, 2, 40);
    expect(r.text).toBe(huge);
  });

  it('treats a non-positive budget as fully truncated', () => {
    expect(tailToHeight('anything', 0, 80)).toEqual({ text: '', truncated: true });
    expect(tailToHeight('', 0, 80)).toEqual({ text: '', truncated: false });
  });
});
