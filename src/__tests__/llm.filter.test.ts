import { ThinkTagFilter, stripThink, extractJson } from '../core/llm.adapter';

describe('ThinkTagFilter', () => {
  function run(chunks: string[]): { text: string; thinking: string } {
    const f = new ThinkTagFilter();
    let text = '';
    let thinking = '';
    for (const c of chunks) {
      const r = f.process(c);
      text += r.text;
      thinking += r.thinking;
    }
    const tail = f.flush();
    text += tail.text;
    thinking += tail.thinking;
    return { text, thinking };
  }

  it('passes plain text through untouched', () => {
    expect(run(['Hello', ' world'])).toEqual({ text: 'Hello world', thinking: '' });
  });

  it('separates a complete think block', () => {
    const r = run(['<think>internal</think>The answer is 4.']);
    expect(r.text).toBe('The answer is 4.');
    expect(r.thinking).toBe('internal');
  });

  it('handles tags split across stream chunks', () => {
    const r = run(['<th', 'ink>reaso', 'ning</thi', 'nk>visible']);
    expect(r.text).toBe('visible');
    expect(r.thinking).toBe('reasoning');
  });

  it('handles multiple interleaved think blocks', () => {
    const r = run(['a<think>x</think>b<think>y</think>c']);
    expect(r.text).toBe('abc');
    expect(r.thinking).toBe('xy');
  });

  it('flushes an unterminated think block as thinking, not text', () => {
    const r = run(['<think>never closed reasoning']);
    expect(r.text).toBe('');
    expect(r.thinking).toBe('never closed reasoning');
  });

  it('does not swallow text that merely resembles a tag prefix', () => {
    const r = run(['a < b and <thin air']);
    expect(r.text).toBe('a < b and <thin air');
    expect(r.thinking).toBe('');
  });

  // The leak from the live transcript: step-3.5/minimax emit reasoning then ONLY a closing tag.
  it('diverts opener-less reasoning ending in a stray </think>', () => {
    const r = run(['The user said hi. Let me greet them.</think>Hey! What are we building today?']);
    expect(r.text).toBe('Hey! What are we building today?');
    expect(r.thinking).toBe('The user said hi. Let me greet them.');
  });

  it('handles opener-less reasoning split across many chunks', () => {
    const r = run(['reason', 'ing more', ' reasoning</thi', 'nk>the ', 'answer']);
    expect(r.text).toBe('the answer');
    expect(r.thinking).toBe('reasoning more reasoning');
  });

  it('treats a tag-free turn as the answer, never as thinking', () => {
    const r = run(['Just', ' a normal answer.']);
    expect(r.text).toBe('Just a normal answer.');
    expect(r.thinking).toBe('');
  });

  // A coding model that never emits a </think> closer would otherwise have its ENTIRE reply
  // buffered as tentative "maybe-reasoning" and only revealed in one burst at flush — which the
  // user perceives as a hang ("spinner rolls, no text"). Once the buffered preamble crosses the
  // cap with no closer in sight, it must be released as visible text MID-stream, before flush.
  it('streams a long opener-less answer live once the preamble cap is hit (no hang)', () => {
    const f = new ThinkTagFilter(true);
    let streamed = '';
    // Feed well over the 240-char cap in chunks, never a closing tag.
    for (let i = 0; i < 40; i++) streamed += f.process('answer chunk number ' + i + ' ').text;
    // Text was emitted DURING streaming (before flush) — not held hostage to a closer.
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed).toContain('answer chunk number');
    const tail = f.flush();
    const all = streamed + tail.text;
    // And the full answer survives intact, nothing diverted to thinking.
    expect(all).toContain('answer chunk number 0');
    expect(all).toContain('answer chunk number 39');
  });

  // The tool-call leak: an inline-reasoning model streams >240 chars of CoT before a tool call and
  // closes it with `</think>`. With the preamble cap OFF (capPreamble=false, what an inline-reasoning
  // model gets), the cap must NOT fire mid-stream and leak that reasoning as the reply; it waits for
  // the closer, so the long preamble lands in `thinking` and only the post-closer text is visible.
  it('does not leak long pre-closer reasoning when the preamble cap is lifted', () => {
    const f = new ThinkTagFilter(true, false);
    let text = '';
    let thinking = '';
    for (let i = 0; i < 40; i++) {
      const r = f.process('reasoning chunk number ' + i + ' ');
      text += r.text;
      thinking += r.thinking;
    }
    // Nothing leaked as visible text yet, despite blowing past the 240-char cap.
    expect(text).toBe('');
    const r = f.process('</think>The visible answer.');
    text += r.text;
    thinking += r.thinking;
    const tail = f.flush();
    text += tail.text;
    thinking += tail.thinking;
    expect(text).toBe('The visible answer.');
    expect(thinking).toContain('reasoning chunk number 0');
    expect(thinking).toContain('reasoning chunk number 39');
  });

  // drainPending: a tool call begins while opener-less reasoning is still buffered (no `</think>`
  // ever arrives because the answer IS the call). The buffered preamble must be reclaimed as
  // thinking, never surfaced as text.
  it('drains still-tentative reasoning to thinking when a tool call starts', () => {
    const f = new ThinkTagFilter(true, false);
    const r = f.process('Let me look that up. I should call the search tool');
    expect(r.text).toBe('');
    const drained = f.drainPending();
    expect(drained).toContain('Let me look that up');
    // After draining, the filter holds nothing and the stream-end flush emits no stray text.
    const tail = f.flush();
    expect(tail.text).toBe('');
    expect(tail.thinking).toBe('');
  });

  it('drainPending is a no-op once visible text is already streaming', () => {
    const f = new ThinkTagFilter(true, false);
    f.process('<think>plan</think>visible answer text');
    // Leading region resolved and we are streaming the answer — a tool call must not steal it.
    expect(f.drainPending()).toBe('');
  });

  it('with implicit mode off, leaves an opener-less closer in the text (plain models)', () => {
    const f = new ThinkTagFilter(false);
    const a = f.process('answer</think>more');
    const b = f.flush();
    expect(a.text + b.text).toContain('answer');
    expect((a.thinking + b.thinking)).toBe('');
  });
});

describe('stripThink', () => {
  it('removes complete think blocks', () => {
    expect(stripThink('<think>plan</think>{"a":1}')).toBe('{"a":1}');
  });

  it('removes a closing-tag-only prefix (providers that omit the opener)', () => {
    expect(stripThink('reasoning...</think>{"a":1}')).toBe('{"a":1}');
  });

  it('leaves normal content alone', () => {
    expect(stripThink('{"a":1}')).toBe('{"a":1}');
  });
});

describe('extractJson', () => {
  it('unwraps a ```json fenced block', () => {
    expect(extractJson('```json\n[{"id":"a"}]\n```')).toBe('[{"id":"a"}]');
  });

  it('unwraps a plain ``` fenced block', () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips surrounding prose and returns the first balanced array', () => {
    expect(extractJson('Here is a JSON array: [{"id":"x"}] hope it helps!')).toBe('[{"id":"x"}]');
  });

  it('does not stop at a bracket inside a string literal', () => {
    expect(extractJson('[{"name":"a]b"}]')).toBe('[{"name":"a]b"}]');
  });

  it('leaves clean JSON unchanged', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('round-trips through JSON.parse for a fenced array', () => {
    expect(JSON.parse(extractJson('```json\n[{"id":"t1","deps":[]}]\n```'))).toEqual([{ id: 't1', deps: [] }]);
  });
});
