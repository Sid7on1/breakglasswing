import { filledCells } from '../cli/components/ProgressBar';

describe('filledCells — progress bar geometry', () => {
  it('maps a fraction to filled cells (rounded)', () => {
    expect(filledCells(0, 10)).toBe(0);
    expect(filledCells(1, 10)).toBe(10);
    expect(filledCells(0.5, 10)).toBe(5);
    expect(filledCells(0.54, 50)).toBe(27);
  });

  it('clamps out-of-range and non-finite fractions', () => {
    expect(filledCells(-0.3, 10)).toBe(0);
    expect(filledCells(1.7, 10)).toBe(10);
    expect(filledCells(NaN, 10)).toBe(0);
    expect(filledCells(Infinity, 10)).toBe(10);
  });

  it('handles a zero/negative width safely', () => {
    expect(filledCells(0.5, 0)).toBe(0);
    expect(filledCells(0.5, -4)).toBe(0);
  });
});
