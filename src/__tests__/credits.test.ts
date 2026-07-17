import { ApiKeyManager } from '../credits/api.key.manager';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;

  beforeEach(() => {
    // The pool deliberately starts its rotation at a RANDOM index (parallel sub-agent workers
    // each build their own manager over the same pool — a deterministic start had them all piling
    // onto key #1). Pin Math.random so these ordering assertions stay deterministic.
    jest.spyOn(Math, 'random').mockReturnValue(0);
    manager = new ApiKeyManager([
      { keyStr: 'key1', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #1' },
      { keyStr: 'key2', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #2' },
      { keyStr: 'key3', baseURL: 'https://api.openai.com/v1', provider: 'openai', label: 'openai #3' },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('RPM pacing: a burst fans out across the pool instead of hammering one key', async () => {
    // 6 rapid calls against 3 keys — each key must be used exactly twice, never 3+ times in the
    // window (that's the pattern that trips per-key RPM limits while siblings sit idle).
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6; i++) {
      const k = await manager.getNextKey();
      counts[k.keyStr!] = (counts[k.keyStr!] || 0) + 1;
    }
    expect(counts).toEqual({ key1: 2, key2: 2, key3: 2 });
  });

  it('RPM pacing never blocks: exhausted pool still returns a key immediately', async () => {
    // All keys "hot" (used within the reuse window) → Pass 2 must still hand one out with no wait.
    for (let i = 0; i < 3; i++) await manager.getNextKey();
    const k = await manager.getNextKey();
    expect(k.keyStr).not.toBeNull();
    expect(k.waitTimeSecs).toBe(0);
  });

  it('setKeys preserves cooldown state for surviving keys and dedupes', async () => {
    await manager.getNextKey(); // key1
    manager.reportKeyResult(0, 429); // key1 on cooldown

    // Rebuild the pool: key1 survives (must KEEP its cooldown), key4 is new, key4 duplicated.
    manager.setKeys([
      { keyStr: 'key1', provider: 'openai', label: 'openai #1' },
      { keyStr: 'key4', provider: 'openai', label: 'openai #2' },
      { keyStr: 'key4', provider: 'openai', label: 'dupe' },
    ]);
    const states = manager.getStates();
    expect(states).toHaveLength(2); // deduped
    expect(states.find(s => s.label === 'openai #1')!.onCooldown).toBe(true); // no clean slate

    // And rotation only hands out the fresh key while key1 cools down.
    expect((await manager.getNextKey()).keyStr).toBe('key4');
    expect((await manager.getNextKey()).keyStr).toBe('key4');
  });

  it('setKeys to an empty pool yields the null key result, not a crash', async () => {
    manager.setKeys([]);
    const k = await manager.getNextKey();
    expect(k.keyStr).toBeNull();
    expect(k.idx).toBeNull();
  });
});

describe('ApiKeyManager — auth-dead fail-fast', () => {
  it('reports allKeysAuthDead only when EVERY key has failed auth', () => {
    const m = new ApiKeyManager([{ keyStr: 'k1' }, { keyStr: 'k2' }]);
    expect(m.allKeysAuthDead()).toBe(false);
    m.reportKeyResult(0, 401);
    expect(m.allKeysAuthDead()).toBe(false); // k2 still healthy
    m.reportKeyResult(1, 401);
    expect(m.allKeysAuthDead()).toBe(true);
  });

  it('a success resets the auth-dead state (key fixed mid-session)', () => {
    const m = new ApiKeyManager([{ keyStr: 'k1' }]);
    m.reportKeyResult(0, 401);
    expect(m.allKeysAuthDead()).toBe(true);
    m.reportKeyResult(0, 200);
    expect(m.allKeysAuthDead()).toBe(false);
  });

  it('one 403 alone is not auth-dead (can be transient), two are', () => {
    const m = new ApiKeyManager([{ keyStr: 'k1' }]);
    m.reportKeyResult(0, 403);
    expect(m.allKeysAuthDead()).toBe(false);
    m.reportKeyResult(0, 403);
    expect(m.allKeysAuthDead()).toBe(true);
  });

  it('429 rate limiting never counts as auth-dead', () => {
    const m = new ApiKeyManager([{ keyStr: 'k1' }]);
    m.reportKeyResult(0, 429);
    m.reportKeyResult(0, 429);
    expect(m.allKeysAuthDead()).toBe(false);
  });
});
