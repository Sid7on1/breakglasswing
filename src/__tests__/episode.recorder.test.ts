import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EpisodeWriter, RecordingProvider, ReplayProvider,
  hashRequest, listEpisodes, loadEpisode, startEpisodeRecording,
} from '../mind/episode.recorder';
import { LLMProvider, Message, ChatOptions, ChatEvent } from '../core/llm.provider';

/** Scripted provider: serves one pre-baked event stream per chat() call, in order. */
function scripted(streams: ChatEvent[][]): LLMProvider {
  let call = 0;
  return {
    async *chat(): AsyncGenerator<ChatEvent> {
      const events = streams[call++] || [{ type: 'done' } as ChatEvent];
      for (const ev of events) yield ev;
    },
  };
}

async function drain(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const OPTS: ChatOptions = { system: 'you are bimax', tools: [{ function: { name: 'BashTool' } }] };

describe('Episode recorder (v2 Phase 4 — black-box bundles + replay)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-episodes-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const TURN1: ChatEvent[] = [
    { type: 'thinking', text: 'let me check ' }, { type: 'thinking', text: 'the file' },
    { type: 'tool_call', id: 't1', name: 'BashTool', args: '{"command":"ls"}' },
    { type: 'usage', prompt: 100, completion: 20 },
    { type: 'done' },
  ];
  const TURN2: ChatEvent[] = [
    { type: 'token', text: 'All ' }, { type: 'token', text: 'done.' },
    { type: 'usage', prompt: 140, completion: 5 },
    { type: 'done' },
  ];

  async function recordTwoTurnEpisode(): Promise<{ id: string; msgs2: Message[] }> {
    const writer = new EpisodeWriter(dir);
    const rec = new RecordingProvider(scripted([TURN1, TURN2]), writer);
    const msgs1: Message[] = [{ role: 'user', content: 'list the files' }];
    await drain(rec.chat(msgs1, OPTS));
    const msgs2: Message[] = [
      ...msgs1,
      { role: 'assistant', tool_calls: [{ id: 't1', type: 'function', function: { name: 'BashTool', arguments: '{"command":"ls"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'a.ts\nb.ts' },
    ];
    await drain(rec.chat(msgs2, OPTS));
    return { id: writer.id, msgs2 };
  }

  it('records a two-call episode: coalesced streams, request deltas, intact hash chain', async () => {
    const { id } = await recordTwoTurnEpisode();

    const ep = loadEpisode(id, dir)!;
    expect(ep).not.toBeNull();
    expect(ep.chainOk).toBe(true);
    expect(ep.header.id).toBe(id);
    expect(ep.calls).toHaveLength(2);

    // Call 0: thinking coalesced, tool call captured, no text.
    expect(ep.calls[0].response.thinking).toBe('let me check the file');
    expect(ep.calls[0].response.toolCalls).toEqual([{ id: 't1', name: 'BashTool', args: '{"command":"ls"}' }]);
    expect(ep.calls[0].response.incomplete).toBeUndefined();
    expect(ep.calls[0].newMessages).toEqual([{ role: 'user', content: 'list the files' }]);

    // Call 1: token stream coalesced; delta holds only the NEW messages (assistant + tool result).
    expect(ep.calls[1].response.text).toBe('All done.');
    expect(ep.calls[1].newMessages.map(m => m.role)).toEqual(['assistant', 'tool']);
    expect(ep.calls[1].newMessages[1].content).toBe('a.ts\nb.ts');
    expect(ep.calls[1].response.usage).toEqual({ prompt: 140, completion: 5 });
  });

  it('replays identical requests deterministically — zero divergence, byte-identical responses', async () => {
    const { id, msgs2 } = await recordTwoTurnEpisode();
    const ep = loadEpisode(id, dir)!;

    const replay = new ReplayProvider(ep.calls);
    const out1 = await drain(replay.chat([{ role: 'user', content: 'list the files' }], OPTS));
    expect(out1).toContainEqual({ type: 'tool_call', id: 't1', name: 'BashTool', args: '{"command":"ls"}' });
    const out2 = await drain(replay.chat(msgs2, OPTS));
    expect(out2).toContainEqual({ type: 'token', text: 'All done.' });
    expect(replay.divergences).toHaveLength(0);
    expect(replay.served).toBe(2);

    // Recording exhausted → unrecoverable error event, not a hang.
    const out3 = await drain(replay.chat(msgs2, OPTS));
    expect(out3[0].type).toBe('error');
  });

  it('flags divergence when the request changes (harness change detection) but still serves in order', async () => {
    const { id } = await recordTwoTurnEpisode();
    const ep = loadEpisode(id, dir)!;

    const replay = new ReplayProvider(ep.calls);
    // A changed system prompt = different request hash = the point of divergence.
    const out = await drain(replay.chat([{ role: 'user', content: 'list the files' }], { ...OPTS, system: 'NEW PROMPT' }));
    expect(out.some(e => e.type === 'tool_call')).toBe(true); // in-order fallback still serves call 0
    expect(replay.divergences).toHaveLength(1);
    expect(replay.divergences[0].idx).toBe(0);
  });

  it('detects tampering — editing a recorded line breaks the chain at that line', async () => {
    const { id } = await recordTwoTurnEpisode();
    const file = path.join(dir, '.bimax', 'episodes', `${id}.jsonl`);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines[1]).toContain('list the files');
    lines[1] = lines[1].replace('list the files', 'delete everything');
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const ep = loadEpisode(id, dir)!;
    expect(ep.chainOk).toBe(false);
    expect(ep.brokenAt).toBe(2);
  });

  it('an abandoned stream (abort) is recorded as incomplete, not lost', async () => {
    const writer = new EpisodeWriter(dir);
    const rec = new RecordingProvider(scripted([TURN1]), writer);
    const gen = rec.chat([{ role: 'user', content: 'hi' }], OPTS);
    await gen.next();          // consume one event…
    await gen.return(undefined as any); // …then abandon the stream (user interrupt)

    const ep = loadEpisode(writer.id, dir)!;
    expect(ep.calls).toHaveLength(1);
    expect(ep.calls[0].response.incomplete).toBe(true);
  });

  it('lists episodes with call/tool-call counts and hashRequest is order-stable on tool names', async () => {
    await recordTwoTurnEpisode();
    const eps = listEpisodes(dir);
    expect(eps).toHaveLength(1);
    expect(eps[0].calls).toBe(2);
    expect(eps[0].toolCalls).toBe(1);

    const msgs: Message[] = [{ role: 'user', content: 'x' }];
    const a = hashRequest(msgs, { tools: [{ function: { name: 'A' } }, { function: { name: 'B' } }] });
    const b = hashRequest(msgs, { tools: [{ function: { name: 'B' } }, { function: { name: 'A' } }] });
    expect(a).toBe(b);
  });

  it('BIMAX_RECORDER=0 disables recording entirely', async () => {
    process.env.BIMAX_RECORDER = '0';
    try {
      const { llm, id } = startEpisodeRecording(scripted([TURN2]), dir);
      expect(id).toBeNull();
      await drain(llm.chat([{ role: 'user', content: 'hi' }], OPTS));
      expect(listEpisodes(dir)).toHaveLength(0);
    } finally {
      delete process.env.BIMAX_RECORDER;
    }
  });
});
