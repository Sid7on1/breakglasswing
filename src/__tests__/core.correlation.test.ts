import { withCorrelation, getCorrelationId } from '../core/correlation';

// Autonomous coverage-climb loop authored the first version of this (one-liner); kept the real
// assertions, formatted it, and added the isolation case.
describe('core/correlation', () => {
  it('has no correlation id outside a context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes a short hex request id inside withCorrelation', async () => {
    const id = await withCorrelation(() => getCorrelationId());
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('isolates ids across separate contexts and clears them after', async () => {
    const a = await withCorrelation(() => getCorrelationId());
    const b = await withCorrelation(() => getCorrelationId());
    expect(a).not.toBe(b);                 // each context gets its own id
    expect(getCorrelationId()).toBeUndefined(); // and it does not leak out
  });
});
