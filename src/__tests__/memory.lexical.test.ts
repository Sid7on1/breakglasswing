import { lexicalRelevance } from '../memory/vector.store';

// The old store dressed up a 512-bucket hash + a cosine that divided by one norm as "semantic"
// search. These assert the replacement is honest, correct lexical relevance.
describe('lexicalRelevance — honest keyword cosine', () => {
  it('scores identical text at ~1', () => {
    expect(lexicalRelevance('async mutex race condition', 'async mutex race condition')).toBeCloseTo(1, 5);
  });

  it('ranks an overlapping doc above a disjoint one', () => {
    const q = 'FreeCreditsTracker async mutex race condition';
    const relevant = lexicalRelevance(q, 'We fixed a race condition in FreeCreditsTracker using an async mutex.');
    const irrelevant = lexicalRelevance(q, 'The TUI renders markdown with glamour and a terracotta theme.');
    expect(relevant).toBeGreaterThan(irrelevant);
    expect(relevant).toBeGreaterThan(0.25); // clears the default search floor
  });

  it('scores fully disjoint text at 0 (no hash-collision false positives)', () => {
    expect(lexicalRelevance('database migration rollback', 'purple elephant umbrella')).toBe(0);
  });

  it('ignores stop words and punctuation', () => {
    // Only "cache" overlaps in content; "the/a/is/for" are stopped out, so it's a real match.
    expect(lexicalRelevance('the cache', 'A cache is good.')).toBeGreaterThan(0);
  });
});
