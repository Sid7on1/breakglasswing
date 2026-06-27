import { SpeculativeSolver } from '../evolution/speculative.solver';

// The full run() drives git worktrees + workers (covered by the e2e runs). Here we unit-test
// the pure approach-proposal helper, which parses/dedupes the model's lines and falls back.
const makeSolver = (chatCompletion: (...a: any[]) => Promise<string>) =>
  new SpeculativeSolver('/tmp', { chatCompletion } as any, 'safe', () => {});

describe('SpeculativeSolver.proposeApproaches', () => {
  it('parses distinct lines, stripping numbering and bullets', async () => {
    const solver = makeSolver(async () => '1. Use a queue\n2) Use threads\n- Use async I/O');
    const out = await solver.proposeApproaches('task', 3);
    expect(out).toEqual(['Use a queue', 'Use threads', 'Use async I/O']);
  });

  it('deduplicates and clamps to n', async () => {
    const solver = makeSolver(async () => 'A\nA\nB\nC\nD');
    const out = await solver.proposeApproaches('task', 2);
    expect(out).toEqual(['A', 'B']);
  });

  it('falls back to generic approaches when the model returns too few', async () => {
    const solver = makeSolver(async () => 'only one line');
    const out = await solver.proposeApproaches('task', 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/distinct strategy/i);
  });

  it('falls back to generic approaches when the model call throws', async () => {
    const solver = makeSolver(async () => { throw new Error('provider down'); });
    const out = await solver.proposeApproaches('task', 2);
    expect(out).toHaveLength(2);
    expect(out.every(a => /distinct strategy/i.test(a))).toBe(true);
  });
});
