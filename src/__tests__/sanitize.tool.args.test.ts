import { sanitizeToolArgs } from '../core/agent.loop';

describe('sanitizeToolArgs — never let malformed tool-call args poison history', () => {
  it('passes valid JSON through (canonicalized)', () => {
    expect(JSON.parse(sanitizeToolArgs('{"query":"BLAST_RADIUS x"}'))).toEqual({ query: 'BLAST_RADIUS x' });
  });

  it('coerces a truncated/unterminated arguments string to {} (the char-10 / NIM bug)', () => {
    // This exact shape — an unterminated value-string — is what 400s every later request on NIM.
    expect(sanitizeToolArgs('{"query": "')).toBe('{}');
    expect(sanitizeToolArgs('{"query":')).toBe('{}');
    expect(sanitizeToolArgs('not json at all')).toBe('{}');
  });

  it('handles empty / null / object inputs', () => {
    expect(sanitizeToolArgs('')).toBe('{}');
    expect(sanitizeToolArgs(null)).toBe('{}');
    expect(sanitizeToolArgs(undefined)).toBe('{}');
    expect(JSON.parse(sanitizeToolArgs({ a: 1 }))).toEqual({ a: 1 });
  });

  it('always returns parseable JSON for any input', () => {
    for (const v of ['{"x":', '][', '{"a":"b"', '', '  ', '{bad}', '{"ok":true}']) {
      expect(() => JSON.parse(sanitizeToolArgs(v))).not.toThrow();
    }
  });
});
