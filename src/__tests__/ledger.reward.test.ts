import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../core/agent.loop';
import { ToolRegistry } from '../tools/tool.registry';
import { LLMProvider, ChatEvent } from '../core/llm.provider';
import { EventLedger, __setEventLedger } from '../mind/event.ledger';

/**
 * Proof + regression for the dead reward loop: the IPS/arms estimator scores a mind-block by folding
 * `tool_outcome` events per episode. If that event never lands in the ledger, every arm reads null and
 * the "self-grading mind" grades nothing. This drives one real tool execution through AgentLoop and
 * asserts the reward event is actually recorded — the loop the on-disk ledgers were missing.
 */
describe('AgentLoop reward wiring', () => {
  let root: string;
  let ledger: EventLedger;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-reward-'));
    ledger = new EventLedger(root);
    __setEventLedger(ledger);
  });
  afterEach(() => { __setEventLedger(null); });

  it('records a tool_outcome event when a tool runs', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'WriteFileTool', description: 'writes a file', schema: {},
      isDestructive: false, isConcurrencySafe: true,
      execute: async () => 'OK: file written',
    } as any);

    // Turn 1 emits a tool call (as leaked text — the loop recovers + executes it). Turn 2 answers.
    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        if (call === 1) {
          yield { type: 'token', text: 'Doing it: {"name": "WriteFileTool", "parameters": {"path": "/tmp/x", "content": "hi"}}' };
        } else {
          yield { type: 'token', text: 'Done.' };
        }
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(mockLlm, registry, null as any);
    for await (const _ of loop.execute([{ role: 'user', content: 'write it' }], 'sys', { maxIterations: 5 })) { /* drain */ }

    const outcomes = ledger.byType('tool_outcome');
    expect(outcomes.length).toBeGreaterThanOrEqual(1);
    expect(outcomes[0].payload.tool).toBe('WriteFileTool');
    expect(outcomes[0].payload.status).toBe('ok');
  });
});
