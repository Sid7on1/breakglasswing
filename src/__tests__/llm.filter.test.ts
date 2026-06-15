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
