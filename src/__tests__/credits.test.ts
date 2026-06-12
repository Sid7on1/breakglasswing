import { ApiKeyManager } from '../credits/api.key.manager';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;

  beforeEach(() => {
    manager = new ApiKeyManager([
      { keyStr: 'key1', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #1' },
      { keyStr: 'key2', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #2' },
      { keyStr: 'key3', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #3' },
    ]);
  });

  it('round robins through keys', async () => {
    const k1 = await manager.getNextKey();
    expect(k1.keyStr).toBe('key1');
    const k2 = await manager.getNextKey();
    expect(k2.keyStr).toBe('key2');
    const k3 = await manager.getNextKey();
    expect(k3.keyStr).toBe('key3');
    const k4 = await manager.getNextKey();
    expect(k4.keyStr).toBe('key1');
  });

  it('puts keys on cooldown and skips them', async () => {
    await manager.getNextKey(); // key1
    manager.reportKeyResult(0, 429); // rate limit key1
    
    // next should be key2, then key3, then key2 again since key1 is on cooldown
    expect((await manager.getNextKey()).keyStr).toBe('key2');
    expect((await manager.getNextKey()).keyStr).toBe('key3');
    expect((await manager.getNextKey()).keyStr).toBe('key2'); // skips key1!
  });
});
