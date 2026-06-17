import { shimmerColorAt, prefersReducedMotion } from '../cli/components/ShimmerText';

const theme: any = { accentShimmer: 'BRIGHT', accent: 'HALO', subtle: 'DIM' };

describe('shimmerColorAt — sweep coloring', () => {
  it('is brightest at the sweep center, a halo adjacent, dim elsewhere', () => {
    expect(shimmerColorAt(3, 3, theme)).toBe('BRIGHT'); // center
    expect(shimmerColorAt(2, 3, theme)).toBe('HALO');   // one left
    expect(shimmerColorAt(4, 3, theme)).toBe('HALO');   // one right
    expect(shimmerColorAt(0, 3, theme)).toBe('DIM');    // far
    expect(shimmerColorAt(9, 3, theme)).toBe('DIM');    // far
  });

  it('moves with the position (the bright cell follows pos)', () => {
    expect(shimmerColorAt(0, 0, theme)).toBe('BRIGHT');
    expect(shimmerColorAt(0, 1, theme)).toBe('HALO');
    expect(shimmerColorAt(0, 5, theme)).toBe('DIM');
  });
});

describe('prefersReducedMotion', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('is off by default and on for truthy BGW_REDUCED_MOTION', () => {
    delete process.env.BGW_REDUCED_MOTION;
    expect(prefersReducedMotion()).toBe(false);
    for (const v of ['1', 'true', 'yes', 'TRUE']) {
      process.env.BGW_REDUCED_MOTION = v;
      expect(prefersReducedMotion()).toBe(true);
    }
    process.env.BGW_REDUCED_MOTION = '0';
    expect(prefersReducedMotion()).toBe(false);
  });
});
