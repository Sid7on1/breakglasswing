import '../cli/commands/meta';
import '../cli/commands/builtins';
import { globalCommandRegistry } from '../cli/commands/registry';

// Regression tests for the slash-menu fixes: /model must apply the model live (adapter +
// config), and /config must be a hub whose options are runnable slash commands.
function getCmd(name: string): any {
  return (globalCommandRegistry as any).commands.get(name);
}

function mockCtx() {
  const applyConfig = jest.fn();
  const saveConfig = jest.fn().mockResolvedValue(undefined);
  const addSystemMessage = jest.fn();
  const executeCommand = jest.fn();
  return {
    cwd: '/tmp',
    options: { model: 'old/model', llmAdapter: { applyConfig } },
    saveConfig, addSystemMessage, executeCommand,
    setActiveMenu: jest.fn(), setActivePrompt: jest.fn(),
    _spies: { applyConfig, saveConfig, addSystemMessage, executeCommand },
  } as any;
}

describe('/model (menu fix)', () => {
  it('menu carries an onSelect that applies the model live + persists', async () => {
    const ctx = mockCtx();
    const res = await getCmd('/model').execute([], ctx);
    expect(res.type).toBe('menu');
    expect(typeof res.onSelect).toBe('function');
    expect(res.options.map((o: any) => o.value)).toContain('minimaxai/minimax-m3');

    res.onSelect({ value: 'gpt-4o' });
    expect(ctx._spies.applyConfig).toHaveBeenCalledWith({ model: 'gpt-4o' });
    expect(ctx._spies.saveConfig).toHaveBeenCalledWith({ model: 'gpt-4o' });
    expect(ctx.options.model).toBe('gpt-4o');
    expect(ctx._spies.addSystemMessage).toHaveBeenCalled();
  });

  it('`/model <id>` applies directly', async () => {
    const ctx = mockCtx();
    await getCmd('/model').execute(['claude-3-5-sonnet-20241022'], ctx);
    expect(ctx._spies.applyConfig).toHaveBeenCalledWith({ model: 'claude-3-5-sonnet-20241022' });
    expect(ctx.options.model).toBe('claude-3-5-sonnet-20241022');
  });
});

describe('/config (hub fix)', () => {
  it('returns a hub whose options are runnable slash commands, incl. the new toggles', async () => {
    const ctx = mockCtx();
    const res = await getCmd('/config').execute([], ctx);
    expect(res.type).toBe('menu');
    expect(typeof res.onSelect).toBe('function');
    const values = res.options.map((o: any) => o.value);
    expect(values).toEqual(expect.arrayContaining(['/model', '/governor verify', '/governor sandbox', '/governor blast-gate', '/autocommit']));
    expect(values.every((v: string) => v.startsWith('/'))).toBe(true);

    res.onSelect({ value: '/model' });
    expect(ctx._spies.executeCommand).toHaveBeenCalledWith('/model');
  });

  it('`/config theme` opens a theme picker of slash commands', async () => {
    const ctx = mockCtx();
    const res = await getCmd('/config').execute(['theme'], ctx);
    expect(res.type).toBe('menu');
    expect(res.options.map((o: any) => o.value)).toContain('/config set theme dark');
  });
});
