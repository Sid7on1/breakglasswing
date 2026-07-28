import { AgentLoop, computerCommitCompletionNudge, computerPercentageCompletionNudge } from '../core/agent.loop';
import { ToolRegistry } from '../tools/tool.registry';
import { ChatEvent, LLMProvider, Message } from '../core/llm.provider';
import * as fs from 'fs';

const observation = JSON.stringify({
  ok: true,
  action: 'open',
  driver: 'bimax-computer-use 0.8.3',
  screenshot: '/tmp/settings.png',
  elements: [
    { element_index: 68, role: 'AXPopUpButton', label: 'Never', frame: { x: 500, y: 100, w: 60, h: 30 } },
    { element_index: 69, role: 'AXButton', label: 'Show Detail — Battery Health · Normal', frame: { x: 620, y: 100, w: 30, h: 30 } },
    { element_index: 70, role: 'AXButton', label: 'Show Detail — Charging', frame: { x: 620, y: 160, w: 30, h: 30 } },
  ],
});

describe('computer percentage completion gate', () => {
  it('selects the contextual detail control when a category is proposed as a percentage answer', () => {
    const messages: Message[] = [
      { role: 'user', content: 'open settings and check battery health percentage' },
      { role: 'tool', tool_call_id: 'open', content: observation },
    ];
    expect(computerPercentageCompletionNudge(messages, 'Battery Health: Normal — percentage is not shown.'))
      .toMatch(/elementIndex 69, "Show Detail — Battery Health · Normal"/);
    expect(computerPercentageCompletionNudge(messages, 'Maximum Capacity is 92%.')).toBe('');
  });

  it('requires Maximum Capacity for a plain battery health request', () => {
    const messages: Message[] = [
      { role: 'user', content: 'open settings and check my battery health' },
      { role: 'tool', tool_call_id: 'open', content: observation },
    ];
    expect(computerPercentageCompletionNudge(messages, 'Your battery health is Normal.'))
      .toMatch(/battery Maximum Capacity percentage.*elementIndex 69/);
    expect(computerPercentageCompletionNudge(messages, 'Battery Condition is Normal and Maximum Capacity is 91%.')).toBe('');
  });

  it('continues the agent loop through detail instead of accepting the early category answer', async () => {
    const clicks: any[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'ComputerTool', description: 'computer', schema: {}, isDestructive: false, isConcurrencySafe: false,
      execute: async (args: any) => {
        if (args.action === 'click') {
          clicks.push(args);
          return JSON.stringify({
            ok: true, action: 'click', driver: 'bimax-computer-use 0.8.3', screenshot: '/tmp/detail.png',
            elements: [{ element_index: 2, role: 'AXStaticText', label: 'Maximum Capacity', value: '92%' }],
          });
        }
        return observation;
      },
    } as any);

    let round = 0;
    const llm: LLMProvider = {
      async *chat(messages: Message[]): AsyncGenerator<ChatEvent> {
        round++;
        if (round === 1) yield { type: 'tool_call', id: 'open', name: 'ComputerTool', args: '{"action":"open","app":"System Settings"}' };
        else if (round === 2) yield { type: 'token', text: 'Battery Health: Normal — the precise percentage is not shown.' };
        else if (round === 3) {
          const gate = messages.find(message => message.role === 'user'
            && String(message.content).includes('[COMPUTER COMPLETION GATE]'));
          expect(gate?.content).toContain('elementIndex 69');
          yield { type: 'tool_call', id: 'detail', name: 'ComputerTool', args: '{"action":"click","elementIndex":69}' };
        } else yield { type: 'token', text: 'Maximum Capacity: 92%.' };
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(llm, registry, null as any);
    let output = '';
    for await (const token of loop.execute(
      [{ role: 'user', content: 'use computer use and check my battery health percentage' }],
      'system', { maxIterations: 6 },
    )) output += token;

    expect(clicks).toEqual([{ action: 'click', elementIndex: 69 }]);
    expect(output).toContain('Maximum Capacity: 92%.');
  });
});

describe('computer action pacing', () => {
  it('executes one computer action per model turn and defers stale-image follow-ups', async () => {
    const screenshot = '/tmp/bimax-one-computer-action.png';
    fs.writeFileSync(screenshot, Buffer.from([1, 2, 3, 4]));
    const executed: string[] = [];
    const registry = new ToolRegistry();
    registry.register({
      name: 'ComputerTool', description: 'computer', schema: {}, isDestructive: false, isConcurrencySafe: false,
      execute: async (args: any) => {
        executed.push(args.action);
        return JSON.stringify({
          ok: true, action: args.action, driver: 'bimax-computer-use 0.8.3',
          screenshot, width: 640, height: 480,
        });
      },
    } as any);

    let round = 0;
    const llm: LLMProvider = {
      canSeeImages: () => true,
      async *chat(messages: Message[]): AsyncGenerator<ChatEvent> {
        round++;
        if (round === 1) {
          yield { type: 'tool_call', id: 'open', name: 'ComputerTool', args: '{"action":"open","app":"Calculator"}' };
          yield { type: 'tool_call', id: 'type', name: 'ComputerTool', args: '{"action":"type","text":"42"}' };
        } else {
          const deferred = messages.find((message: Message) => message.role === 'tool'
            && typeof message.content === 'string'
            && message.content.includes('"deferred":true'));
          expect(deferred?.content).toContain('one ComputerTool action per model turn');
          const freshFrame = messages.find((message: Message) => message.role === 'user'
            && Array.isArray(message.content)
            && String((message.content[0] as any)?.text).includes('source=ComputerTool action=open size=640x480'));
          expect(freshFrame).toBeTruthy();
          yield { type: 'token', text: 'Ready for the next action.' };
        }
        yield { type: 'done' };
      },
    } as any;

    const loop = new AgentLoop(llm, registry, null as any);
    try {
      for await (const _token of loop.execute(
        [{ role: 'user', content: 'use computer use and open Calculator' }],
        'system', { maxIterations: 3 },
      )) { /* drain */ }
      expect(executed).toEqual(['open']);
    } finally {
      fs.rmSync(screenshot, { force: true });
    }
  });
});

describe('computer message commit gate', () => {
  const result = (value: Record<string, unknown>): Message => ({
    role: 'tool', tool_call_id: String(value.action || 'call'),
    content: JSON.stringify({ ok: true, driver: 'bimax-computer-use 0.12.3', ...value }),
  });

  it('continues after typing until a later commit action has fresh visual proof', () => {
    const base: Message[] = [
      { role: 'user', content: 'open WhatsApp and send hi to Mom' },
      result({ action: 'open', app: 'WhatsApp', screenshot: '/tmp/open.png' }),
      result({ action: 'type', app: 'WhatsApp', screenshot: '/tmp/typed.png' }),
    ];
    expect(computerCommitCompletionNudge(base, 'Sent hi to Mom.')).toMatch(/COMPUTER COMMIT GATE/);
    expect(computerCommitCompletionNudge([
      ...base,
      result({ action: 'key', app: 'WhatsApp', summary: 'pressed return in WhatsApp', screenshot: '/tmp/sent.png' }),
    ], 'Sent hi to Mom.')).toBe('');
  });

  it('does not count a Return used in an earlier app as the message commit', () => {
    const messages: Message[] = [
      { role: 'user', content: 'search in Safari, then send the result on WhatsApp' },
      result({ action: 'type', app: 'Safari', screenshot: '/tmp/query.png' }),
      result({ action: 'key', app: 'Safari', summary: 'pressed return in Safari', screenshot: '/tmp/search.png' }),
      result({ action: 'type', app: 'WhatsApp', screenshot: '/tmp/typed.png' }),
    ];
    expect(computerCommitCompletionNudge(messages, 'Done.')).toMatch(/no later successful Return\/Enter/);
  });
});
