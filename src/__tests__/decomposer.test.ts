import { TaskDecomposer } from '../task/decomposer';

// Minimal stub of the LlmAdapter surface the decomposer uses. generateTinyPlans already
// returns parsed JSON in `data` (extractJson/JSON.parse happen inside the adapter).
const makeAdapter = (responses: Array<{ status: number; data: any; retryAfter?: number }>) => {
  let i = 0;
  return {
    generateTinyPlans: jest.fn(async () => responses[Math.min(i++, responses.length - 1)]),
  } as any;
};

const valid = [
  { id: 'task-1', description: 'do A', dependencies: [] },
  { id: 'task-2', description: 'verify', dependencies: ['task-1'] },
];

describe('TaskDecomposer.decompose', () => {
  it('returns the validated DAG for a well-formed plan', async () => {
    const dec = new TaskDecomposer(makeAdapter([{ status: 200, data: valid }]));
    const tasks = await dec.decompose('build something');
    expect(tasks.map(t => t.id)).toEqual(['task-1', 'task-2']);
  });

  it('unwraps a {tasks: [...]} envelope', async () => {
    const dec = new TaskDecomposer(makeAdapter([{ status: 200, data: { tasks: valid } }]));
    const tasks = await dec.decompose('build something');
    expect(tasks).toHaveLength(2);
  });

  it('retries on an invalid shape, then succeeds (auto-correction)', async () => {
    const adapter = makeAdapter([
      { status: 200, data: { not: 'an array' } }, // attempt 1 fails validation
      { status: 200, data: valid },               // attempt 2 succeeds
    ]);
    const dec = new TaskDecomposer(adapter);
    const tasks = await dec.decompose('build something');
    expect(tasks).toHaveLength(2);
    expect(adapter.generateTinyPlans).toHaveBeenCalledTimes(2);
  });

  it('rejects a DAG with circular dependencies', async () => {
    const cyclic = [
      { id: 'a', description: 'x', dependencies: ['b'] },
      { id: 'b', description: 'y', dependencies: ['a'] },
    ];
    const dec = new TaskDecomposer(makeAdapter([{ status: 200, data: cyclic }]));
    await expect(dec.decompose('loop', 2)).rejects.toThrow(/FATAL/);
  });

  it('gives up with a FATAL error after maxRetries of bad output', async () => {
    const dec = new TaskDecomposer(makeAdapter([{ status: 200, data: { bad: true } }]));
    await expect(dec.decompose('build', 2)).rejects.toThrow(/Failed to generate valid task graph/);
  });
});
