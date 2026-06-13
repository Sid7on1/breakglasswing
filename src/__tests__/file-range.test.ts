import { sliceLineRange } from '../tools/file-range';

// G2: the shared line-slicer powering both ReadFileTool ranges and READ_SYMBOL.
describe('sliceLineRange (G2)', () => {
  const src = ['one', 'two', 'three', 'four', 'five'].join('\n');

  it('returns the whole file (numbered) when no range is given', () => {
    const { text, error } = sliceLineRange(src);
    expect(error).toBeUndefined();
    expect(text).toBe('1: one\n2: two\n3: three\n4: four\n5: five');
  });

  it('slices an inclusive 1-based range with absolute line numbers', () => {
    const { text } = sliceLineRange(src, 2, 4);
    expect(text).toBe('2: two\n3: three\n4: four');
  });

  it('clamps an end past EOF to the last line', () => {
    const { text } = sliceLineRange(src, 4, 999);
    expect(text).toBe('4: four\n5: five');
  });

  it('clamps a start below 1 up to line 1', () => {
    const { text } = sliceLineRange(src, 0, 2);
    expect(text).toBe('1: one\n2: two');
  });

  it('errors when start is past end', () => {
    const { text, error } = sliceLineRange(src, 4, 2);
    expect(text).toBeUndefined();
    expect(error).toMatch(/cannot be greater than/);
  });

  it('reads a single line', () => {
    const { text } = sliceLineRange(src, 3, 3);
    expect(text).toBe('3: three');
  });
});
