import { MAC_CONTROL_SCHEMA } from '../server';

describe('structured Desktop goal surface', () => {
  it('offers semantic selectors before coordinate fallback', () => {
    const properties = MAC_CONTROL_SCHEMA.properties;
    expect(properties.query).toBeDefined();
    expect(properties.elementToken).toBeDefined();
    expect(properties.elementIndex).toBeDefined();
    expect(properties.x).toBeDefined();
    expect(properties.y).toBeDefined();
  });

  it('keeps delivery and postcondition fields in the same single-call schema', () => {
    const properties = MAC_CONTROL_SCHEMA.properties;
    expect(properties.text).toBeDefined();
    expect(properties.value).toBeDefined();
    expect(properties.expect).toBeDefined();
    expect(properties.expectMode).toBeDefined();
  });
});
