import { ThinkTagFilter, chooseThinkStrategy } from '../core/llm.adapter';
import { capabilitiesFor, FLOOR } from '../core/capabilities';

// Drive a filter the way the adapter does: pick implicit/cap from the model's capabilities, then
// stream chunks and record what became visible BEFORE the stream-end flush (the streaming contract).
function driveForModel(model: string, chunks: string[], opts?: { toolAfter?: number }) {
  const caps = capabilitiesFor(undefined, model);
  const { implicit, capBounded } = chooseThinkStrategy(caps, /* implicitThinkEnabled */ true, /* knownReasoner */ capsSeed(caps));
  const f = new ThinkTagFilter(implicit, capBounded);
  let visibleDuringStream = '';
  let thinking = '';
  let diverted = '';
  chunks.forEach((c, i) => {
    const r = f.process(c);
    visibleDuringStream += r.text;
    thinking += r.thinking;
    // A tool call starts after `toolAfter` chunks have streamed: drain whatever is still buffered.
    if (opts?.toolAfter === i + 1) diverted += f.drainPending();
  });
  const tail = f.flush();
  return {
    visibleDuringStream,               // text emitted while streaming (not counting the flush)
    text: visibleDuringStream + tail.text,
    thinking: thinking + tail.thinking + diverted,
  };
}
// Mirror the adapter's table seed: inline/native reasoners start "known" so the cap is placed right.
function capsSeed(caps: ReturnType<typeof capabilitiesFor>): boolean {
  return caps.inlineReasoning || caps.nativeThinking;
}

const STEP = 'stepfun-ai/step-3.7-flash'; // the default (opener-based reasoner)

describe('chooseThinkStrategy', () => {
  it('opener-based reasoner (step-3.7) streams from token 1 (implicit off)', () => {
    const caps = capabilitiesFor(undefined, STEP);
    expect(caps.inlineReasoning).toBe(true);
    expect(caps.openerlessReasoning).toBe(false);
    expect(chooseThinkStrategy(caps, true, true).implicit).toBe(false);
  });

  it('opener-LESS reasoner (step-3.5) buffers the ambiguous lead (implicit on)', () => {
    const caps = capabilitiesFor(undefined, 'stepfun-ai/step-3.5-flash');
    expect(caps.openerlessReasoning).toBe(true);
    expect(chooseThinkStrategy(caps, true, true).implicit).toBe(true);
  });

  it('plain-content model streams from token 1', () => {
    const caps = capabilitiesFor(undefined, 'minimax/minimax-m1');
    expect(chooseThinkStrategy(caps, true, false).implicit).toBe(false);
  });

  it('unknown model defaults to bounded implicit buffering (safe)', () => {
    expect(chooseThinkStrategy(FLOOR, true, false)).toEqual({ implicit: true, capBounded: true });
  });

  it('BGW_IMPLICIT_THINK=false forces streaming even for unknown models', () => {
    expect(chooseThinkStrategy(FLOOR, false, false).implicit).toBe(false);
  });
});

describe('streaming contract — the six P0-2 regressions (default model step-3.7)', () => {
  // 1. Tag-free short answer split across chunks: visible deltas arrive BEFORE stream end.
  it('streams a tag-free short answer incrementally, not in one end-of-stream burst', () => {
    const r = driveForModel(STEP, ['Hey! ', 'What are we ', 'building today?']);
    expect(r.visibleDuringStream).toContain('Hey!');            // arrived while streaming
    expect(r.text).toBe('Hey! What are we building today?');
    expect(r.thinking).toBe('');
  });

  // 6. Step-family turn that DOES emit thinking tags: reasoning stays hidden.
  it('hides <thinking>…</thinking> reasoning and streams only the answer', () => {
    const r = driveForModel(STEP, ['<thinking>user said hi, greet them</thinking>', 'Hey there!']);
    expect(r.text).toBe('Hey there!');
    expect(r.thinking).toContain('greet them');
  });

  // 2. Explicit <think> block (canonical tag) also hidden.
  it('hides a canonical <think>…</think> block', () => {
    const r = driveForModel(STEP, ['<think>plan</think>The answer is 42.']);
    expect(r.text).toBe('The answer is 42.');
    expect(r.thinking).toBe('plan');
  });

  // 5. Step-family turn that emits NO thinking tags → streams live.
  it('a no-tag step turn streams live and never diverts to thinking', () => {
    const r = driveForModel(STEP, ['Just', ' answering', ' directly.']);
    expect(r.visibleDuringStream).toContain('Just');
    expect(r.text).toBe('Just answering directly.');
    expect(r.thinking).toBe('');
  });
});

describe('streaming contract — opener-less + tool-call regressions', () => {
  // 3. Opener-less reasoning ending in </think> stays hidden (step-3.5, implicit mode).
  it('diverts opener-less reasoning terminated by a bare </think>', () => {
    const r = driveForModel('stepfun-ai/step-3.5-flash', [
      'The user said hi. Let me greet them.</think>', 'Hey! What are we building today?',
    ]);
    expect(r.text).toBe('Hey! What are we building today?');
    expect(r.thinking).toContain('greet them');
  });

  // 4. A tool call starts while opener-less reasoning is still buffered: divert it, never display it.
  it('drains still-buffered opener-less reasoning to thinking when a tool call starts', () => {
    const r = driveForModel('stepfun-ai/step-3.5-flash',
      ['Let me search the codebase for that symbol'], { toolAfter: 1 });
    // toolAfter fires drainPending() after the chunk; nothing should have surfaced as text.
    expect(r.text).toBe('');
    expect(r.thinking).toContain('search the codebase');
  });
});
