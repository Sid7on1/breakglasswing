import { isProviderFault } from '../core/llm.adapter';

describe('isProviderFault (LLM provider breaker classification)', () => {
  it('counts 5xx, 429, and timeouts (no status / 408) as provider faults', () => {
    for (const s of [500, 502, 503, 504, 520, 429, 408]) expect(isProviderFault(s)).toBe(true);
    expect(isProviderFault(null)).toBe(true);
    expect(isProviderFault(undefined)).toBe(true);
    expect(isProviderFault(0)).toBe(true);
  });

  it('does NOT count client errors (the provider responding fine) as faults', () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isProviderFault(s)).toBe(false);
    expect(isProviderFault(200)).toBe(false);
  });
});
