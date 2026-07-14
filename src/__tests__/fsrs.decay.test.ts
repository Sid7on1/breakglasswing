import { UserModel, __setUserModel } from '../mind/user.model';

// PR4 — FSRS-lite: an assertion's effective half-life GROWS with each explicit restatement, so a
// twice-stated preference decays slower than a once-stated one; three restatements = durable.
// Pure: we drive confidence() through the public assertions() readout with hand-built state.
describe('FSRS-lite assertion stability', () => {
  afterEach(() => __setUserModel(null));

  // Build a UserModel whose backing file holds one assertion, then read its computed confidence.
  const confidenceFor = (count: number, ageDays: number): number => {
    const m = new UserModel('/tmp/does-not-exist-fsrs');
    const lastSeen = new Date(Date.now() - ageDays * 86_400_000).toISOString();
    // Inject state directly (the file won't load, so seed via the private field through any-cast).
    (m as any).data = {
      version: 3, features: {}, decisions: { accepts: 0, rejects: 0 }, history: [],
      assertions: [{ text: 'x', polarity: 'do', alpha: 6, beta: 1, count, lastSeen, embedding: [], status: 'confirmed', source: 'regex' }],
    };
    (m as any).loaded = true;
    return m.assertions()[0].confidence;
  };

  it('a twice-stated preference decays slower than a once-stated one', () => {
    const once = confidenceFor(1, 200);   // base 120d half-life
    const twice = confidenceFor(2, 200);  // 300d half-life → higher retained confidence
    expect(twice).toBeGreaterThan(once);
  });

  it('three restatements are durable (no decay)', () => {
    const thrice = confidenceFor(3, 500);
    expect(thrice).toBeCloseTo(6 / 7, 5); // mean, undecayed
  });

  it('a once-stated preference still drifts toward the 0.5 prior with age', () => {
    const fresh = confidenceFor(1, 0);
    const aged = confidenceFor(1, 300);
    expect(fresh).toBeCloseTo(6 / 7, 5);
    expect(aged).toBeLessThan(0.65);
  });
});
