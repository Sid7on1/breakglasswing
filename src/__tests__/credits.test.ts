import { ApiKeyManager } from '../credits/api.key.manager';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;

  beforeEach(() => {
    manager = new ApiKeyManager(['key1', 'key2', 'key3']);
  });

  it('round robins through keys', () => {
    const k1 = manager.getNextKey();
    expect(k1.keyStr).toBe('key1');
    const k2 = manager.getNextKey();
    expect(k2.keyStr).toBe('key2');
    const k3 = manager.getNextKey();
    expect(k3.keyStr).toBe('key3');
    const k4 = manager.getNextKey();
    expect(k4.keyStr).toBe('key1');
  });

  it('puts keys on cooldown and skips them', () => {
    manager.getNextKey(); // key1
    manager.reportKeyResult(0, 429); // rate limit key1
    
    // next should be key2, then key3, then key2 again since key1 is on cooldown
    expect(manager.getNextKey().keyStr).toBe('key2');
    expect(manager.getNextKey().keyStr).toBe('key3');
    expect(manager.getNextKey().keyStr).toBe('key2'); // skips key1!
  });
});
