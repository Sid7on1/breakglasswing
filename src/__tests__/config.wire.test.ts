import { createConfigWire, CONFIG_WIRE_KEYS, ADAPTER_KEYS } from '../protocol/config.wire';

/**
 * The settings surface behind `configGet` / `configSet`.
 *
 * The regression these pin: `configSet` persisted the model and answered with the config FILE, so
 * a front-end comparing its request against the reply always saw success — while `LlmAdapter` kept
 * serving every request from the model it cached at boot. "I changed the model and it never
 * changed", reported as applied.
 */

/** A stand-in for LlmAdapter that records writes and answers reads from its own loaded state. */
function stubAdapter(initial: Record<string, any> = {}) {
  const state: Record<string, any> = { model: 'boot/model', liteModel: '', visionModel: '', ...initial };
  const applied: Record<string, any>[] = [];
  return {
    applied,
    state,
    applyConfig(cfg: Record<string, any>) {
      applied.push({ ...cfg });
      // Mirror the real adapter: `model` is truthy-guarded, the rest accept a clearing ''.
      for (const [key, value] of Object.entries(cfg)) {
        if (key === 'model' && !value) continue;
        state[key] = value;
      }
    },
    readEffective() { return { ...state }; },
  };
}

function harness(fileConfig: Record<string, any> = {}, adapter = stubAdapter()) {
  const file: Record<string, any> = { model: 'boot/model', theme: 'auto', ...fileConfig };
  const saved: Record<string, any>[] = [];
  let changes = 0;
  const wire = createConfigWire({
    getConfig: () => file,
    saveConfig: async (updates) => { saved.push({ ...updates }); Object.assign(file, updates); },
    llmAdapter: adapter,
    onChanged: () => { changes += 1; },
  });
  return { wire, adapter, file, saved, changes: () => changes };
}

describe('config wire — a write reaches the live adapter', () => {
  it('applies a model change to the adapter, not only to the config file', async () => {
    // THE regression. Without the applyConfig call this passes the file assertion and fails here,
    // which is exactly the shape the bug had in production: persisted, reported, never loaded.
    const { wire, adapter, file, saved } = harness();

    await wire.write({ model: 'chosen/model' });

    expect(saved).toEqual([{ model: 'chosen/model' }]);          // persisted
    expect(file.model).toBe('chosen/model');
    expect(adapter.applied).toEqual([{ model: 'chosen/model' }]); // ...AND loaded
    expect(adapter.readEffective().model).toBe('chosen/model');
  });

  it('answers with what the adapter will actually send, not what the file records', async () => {
    // A file and an adapter that disagree must surface the DISAGREEMENT. Reporting the file here is
    // what let a settings row show the user's own choice back to them while the engine ran another.
    const adapter = stubAdapter({ model: 'actually/loaded' });
    const { wire } = harness({ model: 'only/in/the/file' }, adapter);

    expect(wire.read().model).toBe('actually/loaded');
  });

  it('forwards only the keys present in the patch, so one row cannot clear another slot', async () => {
    const { wire, adapter } = harness();
    await wire.write({ reasoningEffort: 'high' });

    expect(adapter.applied).toEqual([{ reasoningEffort: 'high' }]);
    expect(adapter.applied[0]).not.toHaveProperty('model');
    expect(adapter.applied[0]).not.toHaveProperty('liteModel');
  });

  it('lets an empty value clear a slot that supports clearing', async () => {
    const adapter = stubAdapter({ visionModel: 'some/vlm' });
    const { wire } = harness({}, adapter);

    await wire.write({ visionModel: '' });

    expect(adapter.applied).toEqual([{ visionModel: '' }]);
    expect(wire.read().visionModel).toBe('');
  });

  it('drops keys outside the allowlist instead of persisting them', async () => {
    const { wire, saved, adapter } = harness();

    await wire.write({ model: 'chosen/model', dangerouslySkipPermissions: true, apiKey: 'secret' });

    expect(saved).toEqual([{ model: 'chosen/model' }]);
    expect(saved[0]).not.toHaveProperty('dangerouslySkipPermissions');
    expect(saved[0]).not.toHaveProperty('apiKey');
    expect(adapter.applied).toEqual([{ model: 'chosen/model' }]);
  });

  it('does not persist, apply, or notify when nothing in the patch is writable', async () => {
    const { wire, saved, adapter, changes } = harness();

    await wire.write({ workspaceRoot: '/tmp/elsewhere' });

    expect(saved).toEqual([]);
    expect(adapter.applied).toEqual([]);
    expect(changes()).toBe(0);
  });

  it('notifies attached front-ends exactly once per accepted write', async () => {
    const { wire, changes } = harness();
    await wire.write({ model: 'chosen/model' });
    expect(changes()).toBe(1);
  });

  it('still persists when the adapter is absent or throws', async () => {
    const saved: Record<string, any>[] = [];
    const file: Record<string, any> = { model: 'boot/model' };
    const wire = createConfigWire({
      getConfig: () => file,
      saveConfig: async (u) => { saved.push({ ...u }); Object.assign(file, u); },
      llmAdapter: { applyConfig: () => { throw new Error('adapter is gone'); } },
    });

    await expect(wire.write({ model: 'chosen/model' })).resolves.toBeDefined();
    expect(saved).toEqual([{ model: 'chosen/model' }]); // survives to the next boot
  });

  it('keeps every adapter-owned key inside the wire allowlist', () => {
    // An adapter key that is not writable over the wire is a setting the UI can display but never
    // change — the silent half of the same bug class.
    for (const key of ADAPTER_KEYS) expect(CONFIG_WIRE_KEYS).toContain(key);
  });

  it('keeps secrets and engine internals off the wire', () => {
    for (const forbidden of ['apiKey', 'workspaceRoot', 'dangerouslySkipPermissions', 'onboardingComplete']) {
      expect(CONFIG_WIRE_KEYS).not.toContain(forbidden);
    }
  });
});
