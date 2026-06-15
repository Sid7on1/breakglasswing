import { coerceArgsToSchema } from '../mcp/client';

// The sequential-thinking server's schema (the one that rejected stringified args in the wild).
const seqSchema = {
  type: 'object',
  properties: {
    thought: { type: 'string' },
    nextThoughtNeeded: { type: 'boolean' },
    thoughtNumber: { type: 'integer' },
    totalThoughts: { type: 'integer' },
    isRevision: { type: 'boolean' },
    revisesThought: { type: 'number' },
  },
};

describe('coerceArgsToSchema — MCP weak-model arg coercion', () => {
  it('converts stringified numbers/booleans to their declared types', () => {
    const out = coerceArgsToSchema(
      { thought: 'Let', nextThoughtNeeded: 'true', thoughtNumber: '1', totalThoughts: '3', isRevision: 'false', revisesThought: '2' },
      seqSchema,
    );
    expect(out).toEqual({
      thought: 'Let',          // real strings are left alone
      nextThoughtNeeded: true,
      thoughtNumber: 1,
      totalThoughts: 3,
      isRevision: false,
      revisesThought: 2,
    });
  });

  it('leaves already-correct types untouched', () => {
    const input = { nextThoughtNeeded: true, thoughtNumber: 5, thought: 'x' };
    expect(coerceArgsToSchema(input, seqSchema)).toEqual(input);
  });

  it('does not corrupt non-numeric strings or unknown keys', () => {
    const out = coerceArgsToSchema({ thought: 'not a number', extra: 'keep' }, seqSchema);
    expect(out.thought).toBe('not a number');
    expect(out.extra).toBe('keep');
  });

  it('recurses into nested objects and arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        nums: { type: 'array', items: { type: 'number' } },
        nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
      },
    };
    const out = coerceArgsToSchema({ nums: ['1', '2', 'x'], nested: { flag: 'true' } }, schema);
    expect(out.nums).toEqual([1, 2, 'x']);
    expect(out.nested.flag).toBe(true);
  });

  it('is a no-op when there is no schema', () => {
    const a = { nextThoughtNeeded: 'true' };
    expect(coerceArgsToSchema(a, undefined)).toBe(a);
  });
});
