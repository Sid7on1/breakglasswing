import { classifyStreamError } from '../core/llm.adapter';

/**
 * The agent loop relies on this classification to decide whether a streaming error is
 * fatal, fixable by compaction, or worth a fresh re-ask. Getting the buckets right is
 * what keeps a transient provider hiccup from killing the whole task.
 */
describe('classifyStreamError', () => {
  it('marks context overflow as recoverable via compaction', () => {
    expect(classifyStreamError(new Error('This model maximum context length is 8192 tokens')))
      .toMatchObject({ recoverable: true, kind: 'context' });
    expect(classifyStreamError({ code: 'context_length_exceeded', message: 'too long' }))
      .toMatchObject({ recoverable: true, kind: 'context' });
    expect(classifyStreamError({ status: 413, message: 'payload too large' }))
      .toMatchObject({ recoverable: true, kind: 'context' });
  });

  it('marks a single bad model emission as transient', () => {
    for (const msg of [
      '400 Unterminated string starting at: line 1 column 112',
      '400 This model only supports single tool-calls at once!',
      "the timeout parameter value '300000' is out of range",
    ]) {
      expect(classifyStreamError({ status: 400, message: msg }))
        .toMatchObject({ recoverable: true, kind: 'transient' });
    }
  });

  it('marks stalled streams and server errors as transient', () => {
    expect(classifyStreamError(new Error('Stream read timeout: no data from the API for 60s')))
      .toMatchObject({ status: 408, recoverable: true, kind: 'transient' });
    // The model-naming timeout message must still classify as a recoverable stall.
    expect(classifyStreamError(new Error("LLM stream timeout: model 'minimax-m3' sent no first token for 180s (provider NIM cold/slow — not a tool error)")))
      .toMatchObject({ status: 408, recoverable: true, kind: 'transient' });
    expect(classifyStreamError({ status: 503, message: 'service unavailable' }))
      .toMatchObject({ recoverable: true, kind: 'transient' });
  });

  it('treats genuine client errors as fatal', () => {
    expect(classifyStreamError({ status: 401, message: 'invalid api key' }))
      .toMatchObject({ recoverable: false });
    expect(classifyStreamError({ status: 400, message: 'invalid request: unknown field' }))
      .toMatchObject({ recoverable: false });
  });
});
