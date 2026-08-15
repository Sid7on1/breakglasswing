import { MAC_CONTROL_SCHEMA } from '../server';

describe('Desktop provider evidence contract', () => {
  it('requires one named action and rejects undeclared model arguments', () => {
    expect(MAC_CONTROL_SCHEMA.required).toEqual(['action']);
    expect(MAC_CONTROL_SCHEMA.additionalProperties).toBe(false);
    expect(MAC_CONTROL_SCHEMA.properties.action.description).toContain('Exactly one action');
  });

  it('exposes the identifiers needed to bind an action to a fresh target', () => {
    expect(MAC_CONTROL_SCHEMA.properties.frameId).toBeDefined();
    expect(MAC_CONTROL_SCHEMA.properties.pid).toBeDefined();
    expect(MAC_CONTROL_SCHEMA.properties.windowId).toBeDefined();
    expect(MAC_CONTROL_SCHEMA.properties.expect).toBeDefined();
    expect(MAC_CONTROL_SCHEMA.properties.expectMode).toBeDefined();
  });
});
