import { HeadlessSession } from '../protocol/headless.session';
import { perfSnapshot, __resetPerf } from '../telemetry/perf';

// Drives the REAL HeadlessSession routing so we measure the actual lite-lane path — not a mock of
// it. The persona and adapter are stubbed (no network), so what's measured is BIMAX overhead on the
// conversation lane, which is exactly the P0-3 gate (provider latency is measured separately and
// needs live keys). Ten trivial turns exercise the "at least ten measured trivial turns" deliverable.

// A persona stub that records which lane ran and streams a couple of tokens the way `converse` does.
function makePersona() {
  const calls = { converse: 0, execute: 0 };
  const messages: any[] = [];
  return {
    calls,
    messages,
    async converse(prompt: string, onToken?: (t: string) => void) {
      calls.converse++;
      messages.push({ role: 'user', content: prompt });
      for (const t of ['Hey', '! ', 'What are we building today?']) onToken?.(t);
      const reply = 'Hey! What are we building today?';
      messages.push({ role: 'assistant', content: reply });
      return reply;
    },
    async execute(_prompt: string, onToken?: (t: string) => void) {
      calls.execute++;
      onToken?.('full harness answer');
      return 'full harness answer';
    },
  };
}

function makeSession(persona: ReturnType<typeof makePersona>) {
  const llmAdapter = { userModel: 'stepfun-ai/step-3.7-flash', defaultModel: 'stepfun-ai/step-3.7-flash', chatCompletion: jest.fn() };
  return new HeadlessSession({
    personas: { bimax: persona } as any,
    options: { llmAdapter, maxToolIterations: 10 },
    graphStore: {} as any,
  });
}

describe('lite conversation lane (HeadlessSession)', () => {
  const prevPersist = process.env.BIMAX_PERF_PERSIST;
  beforeEach(() => { __resetPerf(); process.env.BIMAX_PERF_PERSIST = '0'; });
  afterEach(() => { if (prevPersist === undefined) delete process.env.BIMAX_PERF_PERSIST; else process.env.BIMAX_PERF_PERSIST = prevPersist; });

  it('routes a greeting to converse(), never the full execute() harness', async () => {
    const persona = makePersona();
    await makeSession(persona).dispatch('hi');
    expect(persona.calls.converse).toBe(1);
    expect(persona.calls.execute).toBe(0);
  });

  it('routes real coding work to the full harness, not the lite lane', async () => {
    const persona = makePersona();
    await makeSession(persona).dispatch('fix the failing tests in the parser');
    expect(persona.calls.converse).toBe(0);
    expect(persona.calls.execute).toBe(1);
  });

  it('ten measured trivial turns hold the greeting-overhead gate (p95 <= 250ms)', async () => {
    const persona = makePersona();
    const session = makeSession(persona);
    const greetings = ['hi', 'hey', 'thanks', 'ok', 'cool', 'who are you', 'what can you do', 'how are you', 'yo', 'nice'];
    for (const g of greetings) await session.dispatch(g);
    const s = perfSnapshot();
    expect(persona.calls.converse).toBe(10);
    expect(persona.calls.execute).toBe(0);
    expect(s.lastBreakdown?.lane).toBe('lite');
    // Bimax overhead before the (stubbed) provider request must be tiny on the conversation lane.
    expect(s.liteOverheadP95).toBeLessThanOrEqual(250);
  });
});
