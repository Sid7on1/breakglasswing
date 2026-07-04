import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../core/agent.loop';
import { LLMProvider, Message, ChatEvent } from '../core/llm.provider';
import { EpisodeWriter, RecordingProvider, listEpisodes } from '../mind/episode.recorder';
import { replayEpisode } from '../mind/replay.harness';

/** Scripted provider: one pre-baked event stream per chat() call, in order. */
function scripted(streams: ChatEvent[][]): LLMProvider {
  let call = 0;
  return {
    async *chat(): AsyncGenerator<ChatEvent> {
      const events = streams[call++] || [{ type: 'token', text: 'out of script' }, { type: 'done' } as ChatEvent];
      for (const ev of events) yield ev;
    },
  };
}

/** Minimal real-shaped registry for the RECORDING run: one Bash-ish tool with a fixed result. */
function liveRegistry() {
  return {
    getSchemas: () => [{ type: 'function', function: { name: 'ListTool', parameters: { type: 'object', properties: {} } } }],
    getTool: (name: string) => name === 'ListTool'
      ? { name, isConcurrencySafe: false, execute: async () => 'a.ts\nb.ts' }
      : undefined,
  };
}

const SYSTEM = 'you are bimax, terse';

describe('Replay harness (v2 Phase 4 — re-run recorded episodes, divergence reports)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-replay-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Record a real 2-call episode: model asks for ListTool, then answers with text. */
  async function recordEpisode(): Promise<string> {
    const streams: ChatEvent[][] = [
      [
        { type: 'tool_call', id: 'c1', name: 'ListTool', args: '{}' },
        { type: 'done' },
      ],
      [
        { type: 'token', text: 'Two files: a.ts and b.ts.' },
        { type: 'done' },
      ],
    ];
    const writer = new EpisodeWriter(dir);
    const recording = new RecordingProvider(scripted(streams), writer);
    const loop = new AgentLoop(recording, liveRegistry() as any);
    const initial: Message[] = [{ role: 'user', content: 'what files are here?' }];
    let text = '';
    for await (const chunk of loop.execute(initial, SYSTEM, { maxIterations: 4 })) text += chunk;
    expect(text).toContain('Two files');
    return writer.id;
  }

  it('replays an unchanged harness bit-for-bit — the determinism gate', async () => {
    const id = await recordEpisode();

    const report = await replayEpisode(id, { root: dir });
    if ('error' in report) throw new Error(report.error);

    expect(report.callsRecorded).toBe(2);
    expect(report.callsServed).toBe(2);
    expect(report.divergences).toEqual([]);
    expect(report.toolResultsMissing).toBe(0);
    expect(report.systemChanged).toBe(false);
    expect(report.identical).toBe(true);
    expect(report.finalText).toContain('Two files: a.ts and b.ts.');
  });

  it('reports the exact divergence point when the system prompt changes', async () => {
    const id = await recordEpisode();

    const report = await replayEpisode(id, { root: dir, systemPrompt: 'you are bimax, VERBOSE' });
    if ('error' in report) throw new Error(report.error);

    expect(report.systemChanged).toBe(true);
    expect(report.identical).toBe(false);
    // Every request embeds the system prompt, so both calls diverge — starting at #0.
    expect(report.divergences.length).toBeGreaterThanOrEqual(1);
    expect(report.divergences[0].idx).toBe(0);
    // In-order fallback still drives the run to completion on recorded responses.
    expect(report.callsServed).toBe(2);
    expect(report.finalText).toContain('Two files');
  });

  it('a replay does not record a new episode of itself', async () => {
    const id = await recordEpisode();
    const before = listEpisodes(dir).length;
    await replayEpisode(id, { root: dir });
    expect(listEpisodes(dir).length).toBe(before);
  });

  it('refuses to replay a tampered bundle', async () => {
    const id = await recordEpisode();
    const file = path.join(dir, '.bimax', 'episodes', `${id}.jsonl`);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    lines[1] = lines[1].replace('what files are here?', 'rm -rf everything');
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const report = await replayEpisode(id, { root: dir });
    expect('error' in report && /tampered/i.test((report as any).error)).toBe(true);
  });
});
