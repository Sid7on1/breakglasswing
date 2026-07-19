import { cliEvents } from '../cli/events';
import { HeadlessSession } from '../protocol/headless.session';
import { globalDesktopRuntime } from '../computer/desktop.runtime';
import '../cli/commands/meta';

// The headless session must honor /tier identically to Ink's FullScreen: a set_tier event pins the
// model tier and reflects it in the footer via a model_tier emit. (Routing itself is exercised at
// the turn level; here we pin the keystone behavior — set_tier → pin → model_tier — without an LLM.)
describe('HeadlessSession — set_tier routing parity', () => {
  it('pins the tier on set_tier and clears it on auto, emitting model_tier each time', () => {
    // Constructor only wires the set_tier listener; deps aren't touched until a turn runs.
    new HeadlessSession({ personas: {}, options: {}, graphStore: {} as any });

    const seen: any[] = [];
    const onTier = (p: any) => seen.push(p);
    cliEvents.on('model_tier', onTier);
    try {
      cliEvents.emit('set_tier', 'heavy');
      cliEvents.emit('set_tier', 'auto');
    } finally {
      cliEvents.off('model_tier', onTier);
    }

    expect(seen).toEqual([
      { tier: 'heavy', pinned: 'heavy' }, // pinned heavy
      { tier: 'lite', pinned: null },     // auto clears the pin; footer points at lite by default
    ]);
  });

  it('runs an engine continuation without fabricating a visible user message', async () => {
    const execute = jest.fn(async (_prompt: string, onToken: (token: string) => void, options: any) => {
      expect(options.internalTurn).toBe(true);
      onToken('Coordinator continued the outcome.');
      return '';
    });
    const persona = { messages: [], execute } as any;
    const llmAdapter = { userModel: 'same-model', liteModel: 'same-model' } as any;
    const session = new HeadlessSession({
      personas: { bimax: persona },
      options: { llmAdapter, maxToolIterations: 5, governor: { mode: 'default' } },
      graphStore: {} as any,
    });
    const messages: any[] = [];
    const onMessage = (message: any) => messages.push(message);
    cliEvents.on('message', onMessage);
    try {
      await expect(session.dispatchAutonomous('Implement the next outcome step.')).resolves.toBe('completed');
    } finally {
      cliEvents.off('message', onMessage);
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(messages.some(message => message.role === 'user')).toBe(false);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: 'Coordinator continued the outcome.' }),
    ]));
  });

  it('persists slash-command settings through the headless dependency', async () => {
    const saveConfig = jest.fn().mockResolvedValue({});
    const applyConfig = jest.fn();
    const session = new HeadlessSession({
      personas: {},
      options: { model: 'old/model', llmAdapter: { applyConfig } },
      graphStore: {} as any,
      saveConfig,
    });
    await session.dispatch('/model new/model');
    expect(applyConfig).toHaveBeenCalledWith({ model: 'new/model' });
    expect(saveConfig).toHaveBeenCalledWith({ model: 'new/model' });
  });

  it('tears down Computer Use immediately when a turn is interrupted', async () => {
    const dispose = jest.spyOn(globalDesktopRuntime, 'dispose').mockResolvedValue(undefined);
    const execute = jest.fn((_prompt: string, _onToken: any, options: any) => new Promise<void>(resolve => {
      options.signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const session = new HeadlessSession({
      personas: { bimax: { messages: [], execute } as any },
      options: { llmAdapter: { userModel: 'model', liteModel: 'model' }, maxToolIterations: 5, governor: { mode: 'default' } },
      graphStore: {} as any,
    });
    const turn = session.dispatch('perform a multi-step desktop task');
    await new Promise(resolve => setImmediate(resolve));
    session.interrupt();
    expect(dispose).toHaveBeenCalled();
    await turn;
    dispose.mockRestore();
  });
});
